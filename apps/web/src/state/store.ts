import { create } from 'zustand'
import {
  createEmptyProject,
  createTrack,
  addTrack,
  type Project,
  type Note,
} from '@sculptone/score-model'
import { normalizeLoop } from '../compose/loop'
import {
  createHistory,
  record,
  undo as historyUndo,
  redo as historyRedo,
  canUndo,
  canRedo,
  type History,
} from './history'

export type Mode = 'compose' | 'play' | 'transcribe'
export type ComposeView = 'roll' | 'score'

/** 직전 setProject 호출 이후 이 ms 이내 연속 호출이면 코얼레싱한다. */
const COALESCE_MS = 400

export interface AppState {
  activeMode: Mode
  project: Project
  /** 프로젝트 편집 히스토리. setProject로만 갱신된다. */
  history: History<Project>
  /**
   * 내부 전용: 마지막 setProject 호출 시각(ms).
   * state에 포함시켜 getInitialState()/setState(true) 리셋 시 0으로 초기화한다.
   * 외부에서 직접 변경하지 말 것.
   */
  _lastEditAt: number
  selectedTrackId: string
  selectedNoteId: string | null
  quantizeDenom: number
  isPlaying: boolean
  isRecording: boolean
  /** 마지막 stop() 시점의 transport 위치(초). 녹음 커밋 endSec 계산에 사용. */
  recordStopSec: number
  composeView: ComposeView
  /** 사운드 디자인 패널 열림 상태. null = 닫힘. */
  soundPanelTrackId: string | null
  /** 메트로놈 ON/OFF. 기본 false. */
  metronomeEnabled: boolean
  /** 녹음 시작 전 카운트인 마디 수. 0 = 카운트인 없음. 기본 0. */
  countInBars: number
  /**
   * 내부 전용: 카운트인 오프셋(초).
   * useAudio.play()가 재생 시작 직전 설정하며, useRecording 상승 에지에서 읽는다.
   * 카운트인 없으면 0 (useRecording은 Tone.getTransport().seconds를 사용).
   * 외부에서 직접 변경하지 말 것.
   */
  recordingContentStartSec: number
  /** 루프 구간 활성화. 기본 false. 재생 전용 — 녹음 중(keepAlive)에는 엔진이 강제 비활성. */
  loopEnabled: boolean
  /**
   * 루프 시작(틱). 기본 0.
   * 불변식: loopStartTicks < loopEndTicks, 둘 다 >= 0.
   * setLoopRegion으로만 갱신 — normalizeLoop가 항상 적용된다.
   */
  loopStartTicks: number
  /**
   * 루프 종료(틱). 기본 7680 (ppq480 × 4마디).
   * setLoopRegion으로만 갱신.
   */
  loopEndTicks: number
  setLoopEnabled: (enabled: boolean) => void
  /**
   * 루프 구간을 설정한다. normalizeLoop를 내부 적용해 항상 불변식을 보장한다.
   * 직접 loopStartTicks/loopEndTicks를 변경하지 말 것.
   */
  setLoopRegion: (startTicks: number, endTicks: number) => void
  setMetronomeEnabled: (enabled: boolean) => void
  setCountInBars: (bars: number) => void
  setRecordingContentStartSec: (sec: number) => void
  setMode: (mode: Mode) => void
  /**
   * 인플레이스 편집용 — 선택 상태를 유지하고 히스토리에 record한다.
   * 직전 호출로부터 COALESCE_MS 이내 재호출 시 코얼레싱(drags 폭주 방지).
   */
  setProject: (project: Project) => void
  /**
   * 프로젝트 전체 교체용(New/Import/Load).
   * 히스토리를 새로 시작하고 선택을 새 첫 트랙으로 리셋한다.
   */
  replaceProject: (project: Project) => void
  /** 한 단계 실행 취소. canUndo=false이면 no-op. */
  undo: () => void
  /** 한 단계 다시 실행. canRedo=false이면 no-op. */
  redo: () => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
  setRecording: (recording: boolean) => void
  setRecordStopSec: (sec: number) => void
  setComposeView: (view: ComposeView) => void
  setSoundPanelTrackId: (id: string | null) => void
  /** 단축키 도움말 오버레이 표시 여부. 기본 false. */
  showShortcuts: boolean
  setShowShortcuts: (show: boolean) => void
  toggleShortcuts: () => void
  /**
   * 현재 편집 제스처 경계를 닫는다.
   * _lastEditAt을 0으로 리셋해 다음 setProject 호출이 새 undo 스텝이 되게 한다.
   */
  endEdit: () => void
  /**
   * 클립보드에 복사된 노트. null = 클립보드 비어있음.
   * undo 스택에 기록하지 않는다 — setClipboardNote는 history를 건드리지 않음.
   */
  clipboardNote: Note | null
  setClipboardNote: (note: Note | null) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

const project0 = initialProject()

/**
 * selectedTrackId가 project에 없으면 첫 트랙 id(없으면 '')로 보정한다.
 * undo/redo 후 트랙이 사라졌을 때 사용.
 */
function correctTrackId(project: Project, trackId: string): string {
  if (project.tracks.some((t) => t.id === trackId)) return trackId
  return project.tracks[0]?.id ?? ''
}

/**
 * selectedNoteId가 project의 어느 트랙에도 없으면 null로 보정한다.
 * undo/redo 후 노트가 사라졌을 때 사용.
 */
function correctNoteId(project: Project, noteId: string | null): string | null {
  if (noteId === null) return null
  const exists = project.tracks.some((t) => t.notes.some((n) => n.id === noteId))
  return exists ? noteId : null
}

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: project0,
  history: createHistory(project0),
  _lastEditAt: 0,
  selectedTrackId: project0.tracks[0]!.id,
  selectedNoteId: null,
  quantizeDenom: 16,
  isPlaying: false,
  isRecording: false,
  recordStopSec: 0,
  composeView: 'roll',
  soundPanelTrackId: null,
  metronomeEnabled: false,
  countInBars: 0,
  recordingContentStartSec: 0,
  loopEnabled: false,
  loopStartTicks: 0,
  loopEndTicks: 7680,
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
  setLoopRegion: (startTicks, endTicks) => {
    const { loopStart, loopEnd } = normalizeLoop(startTicks, endTicks)
    set({ loopStartTicks: loopStart, loopEndTicks: loopEnd })
  },
  setMetronomeEnabled: (enabled) =>
    set(enabled ? { metronomeEnabled: true } : { metronomeEnabled: false, countInBars: 0 }),
  setCountInBars: (bars) => set({ countInBars: bars }),
  setRecordingContentStartSec: (sec) => set({ recordingContentStartSec: sec }),

  setMode: (mode) => set({ activeMode: mode }),

  setProject: (project) =>
    set((s) => {
      const now = Date.now()
      // _lastEditAt=0은 최초 호출이므로 코얼레싱하지 않는다.
      const coalesce = s._lastEditAt > 0 && now - s._lastEditAt < COALESCE_MS
      const newHistory = record(s.history, project, { coalesce })
      return { project, history: newHistory, _lastEditAt: now }
    }),

  replaceProject: (project) =>
    set({
      project,
      history: createHistory(project),
      _lastEditAt: 0,
      selectedTrackId: project.tracks[0]?.id ?? '',
      selectedNoteId: null,
    }),

  undo: () =>
    set((s) => {
      if (!canUndo(s.history)) return {}
      const newHistory = historyUndo(s.history)
      const project = newHistory.present
      return {
        history: newHistory,
        project,
        _lastEditAt: 0,
        selectedTrackId: correctTrackId(project, s.selectedTrackId),
        selectedNoteId: correctNoteId(project, s.selectedNoteId),
      }
    }),

  redo: () =>
    set((s) => {
      if (!canRedo(s.history)) return {}
      const newHistory = historyRedo(s.history)
      const project = newHistory.present
      return {
        history: newHistory,
        project,
        _lastEditAt: 0,
        selectedTrackId: correctTrackId(project, s.selectedTrackId),
        selectedNoteId: correctNoteId(project, s.selectedNoteId),
      }
    }),

  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setRecording: (recording) => set({ isRecording: recording }),
  setRecordStopSec: (sec) => set({ recordStopSec: sec }),
  setComposeView: (view) => set({ composeView: view }),
  setSoundPanelTrackId: (id) => set({ soundPanelTrackId: id }),
  showShortcuts: false,
  setShowShortcuts: (show) => set({ showShortcuts: show }),
  toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
  endEdit: () => set({ _lastEditAt: 0 }),
  clipboardNote: null,
  setClipboardNote: (note) => set({ clipboardNote: note }),
}))

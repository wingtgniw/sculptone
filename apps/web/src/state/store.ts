import { create } from 'zustand'
import {
  createEmptyProject, createTrack, addTrack, type Project,
} from '@sculptone/score-model'

export type Mode = 'compose' | 'play' | 'transcribe'

export interface AppState {
  activeMode: Mode
  project: Project
  selectedTrackId: string
  selectedNoteId: string | null
  quantizeDenom: number
  isPlaying: boolean
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
  replaceProject: (project: Project) => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

const project0 = initialProject()

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: project0,
  selectedTrackId: project0.tracks[0]!.id,
  selectedNoteId: null,
  quantizeDenom: 16,
  isPlaying: false,
  setMode: (mode) => set({ activeMode: mode }),
  // 인플레이스 편집용: 선택 상태를 유지한다(절대 변경 금지).
  setProject: (project) => set({ project }),
  // 프로젝트 전체 교체용(New/Import 등): 선택을 새 첫 트랙으로 리셋한다.
  replaceProject: (project) =>
    set({ project, selectedTrackId: project.tracks[0]?.id ?? '', selectedNoteId: null }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
}))

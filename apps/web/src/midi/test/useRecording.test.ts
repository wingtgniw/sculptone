import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { useRecording } from '../useRecording'
import { createTrack, addTrack } from '@sculptone/score-model'

// Tone 모킹: transport.seconds를 제어 가능하게 함
let mockSeconds = 0
vi.mock('tone', () => ({
  getTransport: () => ({
    get seconds() {
      return mockSeconds
    },
    stop: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    schedule: vi.fn(),
    scheduleOnce: vi.fn(),
    bpm: { value: 120 },
  }),
  start: vi.fn().mockResolvedValue(undefined),
  Frequency: (n: number) => ({ toNote: () => `note${n}` }),
}))

// ppq 480, tempo 120 → secondsToTicks(s) = s * 960
describe('useRecording', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('재생 중이 아닐 때 handleMidiMessage → 이벤트 무시', () => {
    const { result } = renderHook(() => useRecording())
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(0)
  })

  it('재생 중이지만 isRecording=false → 이벤트 무시', () => {
    const { result } = renderHook(() => useRecording())
    act(() => {
      useStore.getState().setPlaying(true)
    })
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(0)
  })

  it('빈 트랙(노트 0개)에 녹음: arm→play→noteon/noteoff→stop → 해당 트랙에 노트 커밋', () => {
    const { result } = renderHook(() => useRecording())

    // arm + play (상승 에지)
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // noteon @0
    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 96 })
    })
    // noteoff @0.5
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    // stop: 위치 스냅샷 후 transport 리셋(seconds 0) → isPlaying false (하강 에지 커밋)
    mockSeconds = 1.0
    act(() => {
      useStore.getState().setRecordStopSec(1.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.velocity).toBe(96)
    // 0.5s = 480 ticks
    expect(notes[0]!.duration).toBe(480)
  })

  it('Stop 시 dangling noteon(noteoff 없이 누름 유지)이 recordStopSec까지 양수 duration으로 커밋', () => {
    const { result } = renderHook(() => useRecording())

    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // noteon @0, noteoff 없음 (계속 누름)
    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })

    // 녹음이 2.0s까지 진행됨 → stop 스냅샷 2.0, 그 후 transport.stop()이 위치를 0으로 리셋
    mockSeconds = 2.0
    act(() => {
      useStore.getState().setRecordStopSec(2.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    // dangling을 recordStopSec(2.0)까지 마감 → 2.0s = 1920 ticks (양수 duration)
    expect(notes[0]!.duration).toBe(1920)
  })

  it('Record disarm(재생 유지한 채 record off) 시 수집 테이크가 커밋된다', () => {
    const { result } = renderHook(() => useRecording())

    // play 먼저
    act(() => {
      useStore.getState().setPlaying(true)
    })
    // arm (상승 에지)
    mockSeconds = 0
    act(() => {
      useStore.getState().setRecording(true)
    })

    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 62, velocity: 90 })
    })
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 62, velocity: 0 })
    })

    // disarm: record off (isPlaying은 true 유지) → 하강 에지 커밋
    mockSeconds = 0.6
    act(() => {
      useStore.getState().setRecording(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(62)
    // 재생은 계속 유지
    expect(useStore.getState().isPlaying).toBe(true)
  })

  it('arm-after-play: 재생 먼저 → 이후 arm → 그 시점부터 start 기준이 잡혀 노트 start가 0', () => {
    const { result } = renderHook(() => useRecording())

    // 재생 시작, 이미 2.0s 진행된 상태
    act(() => {
      useStore.getState().setPlaying(true)
    })
    mockSeconds = 2.0
    // 이제 arm (상승 에지 → recordStart = 2.0)
    act(() => {
      useStore.getState().setRecording(true)
    })

    // arm 시점 직후 noteon @2.0 → timeSec 0
    mockSeconds = 2.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 64, velocity: 100 })
    })
    mockSeconds = 2.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 64, velocity: 0 })
    })

    mockSeconds = 3.0
    act(() => {
      useStore.getState().setRecordStopSec(3.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    // arm 기준으로 정렬 → start 0 (재생 경과분 1920틱 어긋남이 아님)
    expect(notes[0]!.start).toBe(0)
    expect(notes[0]!.duration).toBe(480)
  })

  it('녹음 중 selectedTrack을 바꿔도 커밋은 녹음 시작 시 트랙으로 들어간다', () => {
    const { result } = renderHook(() => useRecording())

    // 두 번째 트랙 추가
    const trackB = createTrack('Bass')
    act(() => {
      const s = useStore.getState()
      s.setProject(addTrack(s.project, trackB))
    })
    const trackAId = useStore.getState().project.tracks[0]!.id
    act(() => {
      useStore.getState().selectTrack(trackAId)
    })

    // arm + play (recordTrackId = A 캡처)
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 녹음 중 선택 트랙을 B로 전환
    act(() => {
      useStore.getState().selectTrack(trackB.id)
    })

    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 65, velocity: 100 })
    })
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 65, velocity: 0 })
    })

    mockSeconds = 1.0
    act(() => {
      useStore.getState().setRecordStopSec(1.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const tracks = useStore.getState().project.tracks
    const a = tracks.find((t) => t.id === trackAId)!
    const b = tracks.find((t) => t.id === trackB.id)!
    expect(a.notes).toHaveLength(1) // 녹음 시작 트랙 A로 커밋
    expect(b.notes).toHaveLength(0)
  })

  it('녹음 시작 트랙이 녹음 중 삭제되면 커밋을 생략한다(크래시 없음)', () => {
    const { result } = renderHook(() => useRecording())

    const trackB = createTrack('Bass')
    act(() => {
      const s = useStore.getState()
      s.setProject(addTrack(s.project, trackB))
    })
    const trackAId = useStore.getState().project.tracks[0]!.id
    act(() => {
      useStore.getState().selectTrack(trackAId)
    })

    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    // 녹음 시작 트랙 A 삭제
    act(() => {
      const s = useStore.getState()
      s.setProject({ ...s.project, tracks: s.project.tracks.filter((t) => t.id !== trackAId) })
    })

    mockSeconds = 1.0
    act(() => {
      useStore.getState().setRecordStopSec(1.0)
    })
    mockSeconds = 0
    expect(() => {
      act(() => {
        useStore.getState().setPlaying(false)
      })
    }).not.toThrow()

    // 남은 트랙 B에 잘못 커밋되지 않음
    const b = useStore.getState().project.tracks.find((t) => t.id === trackB.id)!
    expect(b.notes).toHaveLength(0)
  })

  it('재생 중 record 재토글 시 이전 테이크 버퍼가 다음 테이크에 섞이지 않는다', () => {
    const { result } = renderHook(() => useRecording())

    // play
    act(() => {
      useStore.getState().setPlaying(true)
    })

    // take 1: arm → 60 → disarm (커밋 + 버퍼 클리어)
    mockSeconds = 0
    act(() => {
      useStore.getState().setRecording(true)
    })
    mockSeconds = 0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })
    mockSeconds = 0.6
    act(() => {
      useStore.getState().setRecording(false)
    })

    // disarm 직후 1개 커밋되어 있어야 함
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(1)

    // take 2: 재arm → 67 → disarm
    mockSeconds = 1.0
    act(() => {
      useStore.getState().setRecording(true)
    })
    mockSeconds = 1.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 67, velocity: 100 })
    })
    mockSeconds = 1.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 67, velocity: 0 })
    })
    mockSeconds = 1.6
    act(() => {
      useStore.getState().setRecording(false)
    })

    const pitches = useStore
      .getState()
      .project.tracks[0]!.notes.map((n) => n.pitch)
      .sort((a, b) => a - b)
    // 유령(60 중복) 없이 정확히 [60, 67]
    expect(pitches).toEqual([60, 67])
  })

  it('정지 시 isRecording=false가 된다', () => {
    renderHook(() => useRecording())

    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })
    act(() => {
      useStore.getState().setPlaying(false)
    })

    expect(useStore.getState().isRecording).toBe(false)
  })
})

describe('useRecording — 카운트인 타이밍', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('카운트인 4초: 카운트인 중(0..4s) 입력은 노트로 커밋되지 않는다', () => {
    const { result } = renderHook(() => useRecording())

    // recordingContentStartSec = 4.0 (2마디 카운트인, 120BPM 4/4)
    act(() => {
      useStore.getState().setRecordingContentStartSec(4.0)
    })

    // arm + play (상승 에지: recordStartSec = 4.0)
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 카운트인 중 입력 (transport.seconds = 1.5, timeSec = 1.5 - 4.0 = -2.5 → 음수)
    mockSeconds = 1.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    mockSeconds = 2.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    // 콘텐츠 시작 후 정지
    mockSeconds = 4.5
    act(() => {
      useStore.getState().setRecordStopSec(4.5)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    // 카운트인 중 입력이 제외되어 노트 없음
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(0)
  })

  it('카운트인 4초: 콘텐츠 구간(4s 이후) 입력은 콘텐츠 기준 시간으로 커밋된다', () => {
    const { result } = renderHook(() => useRecording())

    act(() => {
      useStore.getState().setRecordingContentStartSec(4.0)
    })

    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 콘텐츠 구간 입력: transport.seconds=4.0, timeSec = 4.0-4.0 = 0.0 (콘텐츠 시작 기준)
    mockSeconds = 4.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 96 })
    })
    // noteoff at 4.5s → timeSec=0.5s → duration = 0.5s = 480 ticks (120BPM ppq480)
    mockSeconds = 4.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    mockSeconds = 5.0
    act(() => {
      useStore.getState().setRecordStopSec(5.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.start).toBe(0) // timeSec=0 → 0 ticks
    expect(notes[0]!.duration).toBe(480) // 0.5s = 480 ticks
  })

  it('[fix3] 카운트인 오프셋 소비 후 re-arm 시 stale 오프셋 미사용 단언', () => {
    const { result } = renderHook(() => useRecording())

    // 카운트인 오프셋 4.0 설정 (useAudio.play()가 하는 작업 시뮬레이션)
    act(() => {
      useStore.getState().setRecordingContentStartSec(4.0)
    })

    // arm + play (상승 에지: recordingContentStartSec=4.0 소비 후 리셋)
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // fix3 핵심 단언: 상승 에지에서 소비 즉시 리셋되어야 한다
    expect(useStore.getState().recordingContentStartSec).toBe(0)

    // take 1 disarm (재생 유지)
    mockSeconds = 1.0
    act(() => {
      useStore.getState().setRecording(false)
    })

    // 재-arm (transport.seconds = 1.5 — stale 4.0을 쓰면 timeSec=-2.5로 필터됨)
    mockSeconds = 1.5
    act(() => {
      useStore.getState().setRecording(true)
    })

    // 재-arm 구간에 노트 입력 (timeSec = 1.5 - 1.5 = 0 이어야 함)
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })
    mockSeconds = 2.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    // 정지
    mockSeconds = 2.5
    act(() => {
      useStore.getState().setRecordStopSec(2.5)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    // stale 오프셋 미사용: timeSec=0 → 커밋됨 (stale이면 timeSec=-2.5 → 필터 → notes=0)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(0)
  })

  it('카운트인 없음(recordingContentStartSec=0): 기존 arm-after-play 동작이 보존된다', () => {
    const { result } = renderHook(() => useRecording())

    // recordingContentStartSec = 0 (기본값 — 카운트인 없음)
    // 재생이 2.0s 진행된 후 arm
    act(() => {
      useStore.getState().setPlaying(true)
    })
    mockSeconds = 2.0
    act(() => {
      useStore.getState().setRecording(true)
    })
    // arm 시점 transport.seconds=2.0 → recordStartSec = 2.0 (Tone.getTransport().seconds 경로)

    mockSeconds = 2.0
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 64, velocity: 80 })
    })
    mockSeconds = 2.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 64, velocity: 0 })
    })

    mockSeconds = 3.0
    act(() => {
      useStore.getState().setRecordStopSec(3.0)
    })
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(false)
    })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(0) // timeSec=0 (2.0-2.0) → 0 ticks
    expect(notes[0]!.duration).toBe(480)
  })
})

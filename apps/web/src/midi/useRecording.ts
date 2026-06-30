import { useCallback, useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { useStore } from '../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { recordedEventsToNotes, type RawMidiEvent } from './recording'
import type { MidiNoteMessage } from './parse'

/**
 * MIDI 이벤트를 수집하고 take를 트랙에 커밋하는 훅.
 *
 * 사용 패턴:
 *   const { handleMidiMessage } = useRecording()
 *   const { ... } = useMidi(handleMidiMessage)
 *
 * 핵심 개념: active = (isPlaying && isRecording).
 *   - active 상승 에지에서 take 시작(버퍼/시작기준/대상트랙 초기화).
 *   - active 하강 에지에서 take 커밋.
 * 이 분리로 빈 트랙 녹음, dangling 노트 마감, disarm 커밋, arm-after-play 정렬,
 * 트랙 전환/삭제 시 오배치, 재토글 유령 노트를 모두 해결한다.
 *
 * 카운트인 통합:
 *   - useAudio.play()가 countInDurationSec을 store.recordingContentStartSec에 동기 설정.
 *   - 상승 에지에서 recordingContentStartSec > 0이면 그 값을 recordStart 기준으로 사용.
 *   - recordingContentStartSec = 0이면 기존 Tone.getTransport().seconds 경로 (arm-after-play 보존).
 *   - 카운트인 중 입력(timeSec < 0)은 commitTake에서 필터링해 제외.
 */
export function useRecording() {
  const eventsRef = useRef<RawMidiEvent[]>([])
  const recordStartSecRef = useRef(0)
  // take 시작 시점에 고정한 대상 트랙 (녹음 중 선택 변경/삭제와 무관)
  const recordTrackIdRef = useRef<string>('')
  // active의 직전 값 — 상승/하강 에지 감지
  const wasActiveRef = useRef(false)

  // ref 미러: MIDI 콜백의 stale 클로저 방지
  const isPlayingRef = useRef(false)
  const isRecordingRef = useRef(false)

  const isPlaying = useStore((s) => s.isPlaying)
  const isRecording = useStore((s) => s.isRecording)

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])
  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])

  /** 수집한 take를 녹음 시작 트랙에 커밋한다. */
  const commitTake = useCallback(() => {
    const events = eventsRef.current
    if (events.length === 0) {
      eventsRef.current = []
      return
    }

    const recordStartSec = recordStartSecRef.current
    const trackId = recordTrackIdRef.current
    const {
      project,
      quantizeDenom,
      isPlaying: stillPlaying,
      recordStopSec,
      setProject,
    } = useStore.getState()

    // 녹음 시작 트랙이 더 이상 없으면(삭제됨) 커밋 생략
    if (!project.tracks.some((t) => t.id === trackId)) {
      eventsRef.current = []
      return
    }

    // disarm 경로(재생 유지)는 라이브 transport 위치를,
    // stop 경로(정지)는 stop 직전 스냅샷(recordStopSec)을 종료 시점으로 사용.
    const endAbs = stillPlaying ? Tone.getTransport().seconds : recordStopSec
    const endSec = Math.max(0, endAbs - recordStartSec)

    // 카운트인 중(timeSec < 0) 입력 제외.
    // 카운트인 없는 경우(recordStartSec = Tone seconds) 모든 이벤트는 timeSec >= 0.
    const contentEvents = events.filter((e) => e.timeSec >= 0)

    const noteDataList = recordedEventsToNotes(contentEvents, {
      ppq: project.transport.ppq,
      tempo: project.transport.tempo,
      quantizeDenom,
      endSec,
    })

    if (noteDataList.length > 0) {
      let updated = project
      for (const noteData of noteDataList) {
        updated = addNote(updated, trackId, createNote(noteData))
      }
      setProject(updated)
    }
    eventsRef.current = []
  }, [])

  // active = isPlaying && isRecording 의 상승/하강 에지에서 take 시작/커밋
  useEffect(() => {
    const active = isPlaying && isRecording
    const was = wasActiveRef.current

    if (active && !was) {
      // 상승 에지: 새 take 시작 — 버퍼/시작기준/대상트랙 고정
      eventsRef.current = []
      // 카운트인 오프셋이 있으면 그것을 기준으로, 없으면 현재 transport 위치를 기준으로 한다.
      // - 카운트인 녹음: recordingContentStartSec = countInDur > 0
      //   → transport가 0부터 시작, 카운트인 구간(0..countInDur) 중 입력은 timeSec < 0 → 필터됨
      // - 일반 녹음 / arm-after-play: recordingContentStartSec = 0
      //   → Tone.getTransport().seconds(현재 재생 위치)를 기준으로 기존 동작 유지
      const { recordingContentStartSec } = useStore.getState()
      recordStartSecRef.current =
        recordingContentStartSec > 0 ? recordingContentStartSec : Tone.getTransport().seconds
      // 소비 후 즉시 리셋: 재-arm 시 stale 오프셋 방지 (같은 세션 재-arm은 Tone.seconds 경로로 fall-through)
      useStore.getState().setRecordingContentStartSec(0)
      recordTrackIdRef.current = useStore.getState().selectedTrackId
    } else if (!active && was) {
      // 하강 에지: take 커밋
      commitTake()
      // Stop 경로(재생 종료)면 녹음 disarm. disarm 경로(재생 유지)는 그대로 둔다.
      if (!isPlaying) useStore.getState().setRecording(false)
    }

    wasActiveRef.current = active
  }, [isPlaying, isRecording, commitTake])

  const handleMidiMessage = useCallback((msg: MidiNoteMessage) => {
    if (!isPlayingRef.current || !isRecordingRef.current) return
    const timeSec = Tone.getTransport().seconds - recordStartSecRef.current
    eventsRef.current.push({
      kind: msg.type,
      pitch: msg.pitch,
      velocity: msg.velocity,
      timeSec,
    })
  }, []) // 의도적 stable callback: ref로 최신 상태 접근

  return { handleMidiMessage }
}

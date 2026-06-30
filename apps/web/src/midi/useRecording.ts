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
    // transport.stop()이 위치를 0으로 리셋한 뒤 읽어도 dangling 노트가 버려지지 않게 한다.
    const endAbs = stillPlaying ? Tone.getTransport().seconds : recordStopSec
    const endSec = Math.max(0, endAbs - recordStartSec)

    const noteDataList = recordedEventsToNotes(events, {
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
      recordStartSecRef.current = Tone.getTransport().seconds
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

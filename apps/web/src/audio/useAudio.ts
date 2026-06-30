import { useCallback, useEffect, useRef } from 'react'
import {
  createInstrument,
  descriptorToToneSpec,
  getPreset,
  createInstrumentFromSound,
} from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { createMetronome, barsToSeconds, type MetronomeHandle } from './metronome'
import { useStore } from '../state/store'
import type { Project, Track } from '@sculptone/score-model'

// ── 캐시 키 ───────────────────────────────────────────────────

function resolveSoundCacheKey(track: Track): string {
  if (track.sound.kind === 'preset') return `preset:${track.sound.presetId}`
  return `patch:${JSON.stringify(track.sound)}`
}

// ── instrument 생성 분기 ──────────────────────────────────────

function buildTrackInstrument(track: Track): MultiInstrument & { dispose: () => void } {
  if (track.sound.kind === 'patch') {
    return createInstrumentFromSound(track.sound) as MultiInstrument & { dispose: () => void }
  }
  const desc = getPreset(track.sound.presetId) ?? getPreset('acoustic-piano')!
  const inst = createInstrument(descriptorToToneSpec(desc))
  return inst as unknown as MultiInstrument & { dispose: () => void }
}

export function useAudio() {
  const instrumentsRef = useRef(new Map<string, ReturnType<typeof buildTrackInstrument>>())
  const soundKeyRef = useRef(new Map<string, string>())
  const engineRef = useRef<PlaybackEngine | null>(null)
  const playGenRef = useRef(0)
  // 메트로놈 인스턴스: metronomeEnabled=true일 때만 생성, dispose()로 정리
  const metronomeRef = useRef<MetronomeHandle | null>(null)

  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        soundKeyRef.current.delete(trackId)
      }
    }
    for (const track of project.tracks) {
      const key = resolveSoundCacheKey(track)
      const cachedKey = soundKeyRef.current.get(track.id)
      if (cachedKey !== key || !instrumentsRef.current.has(track.id)) {
        instrumentsRef.current.get(track.id)?.dispose()
        instrumentsRef.current.set(track.id, buildTrackInstrument(track))
        soundKeyRef.current.set(track.id, key)
      }
    }
  }, [])

  const play = useCallback(() => {
    const { project, isRecording, metronomeEnabled, countInBars, setRecordingContentStartSec } =
      useStore.getState()

    syncInstruments(project)

    // ── 카운트인 오프셋 계산 ──────────────────────────────────
    // isRecording 중이고 countInBars > 0일 때만 카운트인 적용.
    // 재생 전용(isRecording=false)이나 카운트인 없으면 0.
    const countInDurationSec =
      metronomeEnabled && isRecording && countInBars > 0
        ? barsToSeconds(
            countInBars,
            project.transport.tempo,
            project.transport.timeSignature as [number, number],
          )
        : 0

    // recordingContentStartSec를 동기적으로 설정 — useRecording 상승 에지가
    // 이 값을 읽을 때 반드시 최신값이어야 한다 (React 18 automatic batching 활용).
    setRecordingContentStartSec(countInDurationSec)

    // ── 메트로놈 인스턴스 관리 ────────────────────────────────
    if (metronomeEnabled) {
      // 인스턴스가 없으면 새로 생성 (이전 play에서 이미 생성했으면 재사용)
      if (!metronomeRef.current) {
        metronomeRef.current = createMetronome()
      }
    } else {
      // metronomeEnabled=false면 기존 인스턴스 정리
      if (metronomeRef.current) {
        metronomeRef.current.dispose()
        metronomeRef.current = null
      }
    }

    const gen = ++playGenRef.current

    engineRef.current = createPlaybackEngine((trackId) => {
      return instrumentsRef.current.get(trackId) ?? null
    })

    void engineRef.current.play(
      project,
      () => {
        useStore.getState().setPlaying(false)
      },
      () => playGenRef.current === gen,
      {
        keepAlive: isRecording,
        metronome: metronomeRef.current ?? undefined,
        countInDurationSec,
      },
    )
  }, [syncInstruments])

  const stop = useCallback(() => {
    playGenRef.current++
    const stopped = engineRef.current?.getSeconds() ?? 0
    useStore.getState().setRecordStopSec(stopped)
    engineRef.current?.stop()
  }, [])

  const getSeconds = useCallback(() => engineRef.current?.getSeconds() ?? 0, [])

  useEffect(() => {
    return () => {
      playGenRef.current++
      engineRef.current?.stop()
      for (const inst of instrumentsRef.current.values()) inst.dispose()
      instrumentsRef.current.clear()
      soundKeyRef.current.clear()
      // 메트로놈 정리
      metronomeRef.current?.dispose()
      metronomeRef.current = null
    }
  }, [])

  return { play, stop, getSeconds }
}

import { useCallback, useEffect, useRef } from 'react'
import {
  createInstrument,
  descriptorToToneSpec,
  getPreset,
  createInstrumentFromSound,
} from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { useStore } from '../state/store'
import type { Project, Track } from '@sculptone/score-model'

// ── 캐시 키 ───────────────────────────────────────────────────
// preset: "preset:<presetId>" / patch: "patch:<JSON>" (모든 필드 변경 감지)

function resolveSoundCacheKey(track: Track): string {
  if (track.sound.kind === 'preset') return `preset:${track.sound.presetId}`
  return `patch:${JSON.stringify(track.sound)}`
}

// ── instrument 생성 분기 ──────────────────────────────────────
// preset → 기존 createInstrument 경로(기존 mock 호환).
// patch  → createInstrumentFromSound 경로(신규 mock).

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
  const soundKeyRef = useRef(new Map<string, string>()) // trackId → cacheKey
  const engineRef = useRef<PlaybackEngine | null>(null)
  const playGenRef = useRef(0)

  /**
   * 프로젝트 트랙과 instrument Map을 동기화한다.
   * - 삭제된 트랙 → dispose + Map 제거.
   * - 신규 또는 sound 변경 트랙 → dispose + 재생성.
   */
  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))

    // 삭제된 트랙 정리
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        soundKeyRef.current.delete(trackId)
      }
    }

    // 신규 또는 sound 변경 트랙
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
    const { project, isRecording } = useStore.getState()
    syncInstruments(project)

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
      { keepAlive: isRecording },
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
    }
  }, [])

  return { play, stop, getSeconds }
}

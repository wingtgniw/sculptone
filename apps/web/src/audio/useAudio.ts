import { useCallback, useEffect, useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { useStore } from '../state/store'
import type { Project } from '@sculptone/score-model'

/** 트랙 ID → 현재 presetId 캐시 (변경 감지용) */
type PresetCache = Map<string, string>

function resolvePresetId(project: Project, trackId: string): string {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) return 'acoustic-piano'
  return track.sound.kind === 'preset' ? track.sound.presetId : 'acoustic-piano'
}

function buildInstrument(presetId: string): MultiInstrument & { dispose: () => void } {
  const desc = getPreset(presetId) ?? getPreset('acoustic-piano')!
  const inst = createInstrument(descriptorToToneSpec(desc))
  // Tone.PolySynth는 volume AudioParam과 dispose()를 가짐
  return inst as unknown as MultiInstrument & { dispose: () => void }
}

export function useAudio() {
  const instrumentsRef = useRef(new Map<string, ReturnType<typeof buildInstrument>>())
  const presetCacheRef = useRef<PresetCache>(new Map())
  const engineRef = useRef<PlaybackEngine | null>(null)
  // cold-start 레이스 가드용 세대 토큰
  const playGenRef = useRef(0)

  /**
   * 프로젝트의 모든 트랙에 대해:
   * - 신규 또는 preset 변경 시 → dispose 후 재생성
   * - 삭제된 트랙 → dispose 후 Map에서 제거
   */
  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))

    // 삭제된 트랙 instrument dispose
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        presetCacheRef.current.delete(trackId)
      }
    }

    // 신규 또는 preset 변경 트랙 instrument 생성/재생성
    for (const track of project.tracks) {
      const presetId = resolvePresetId(project, track.id)
      const cached = presetCacheRef.current.get(track.id)
      if (cached !== presetId || !instrumentsRef.current.has(track.id)) {
        // 기존 있으면 dispose
        instrumentsRef.current.get(track.id)?.dispose()
        instrumentsRef.current.set(track.id, buildInstrument(presetId))
        presetCacheRef.current.set(track.id, presetId)
      }
    }
  }, [])

  const play = useCallback(() => {
    const { project, isRecording } = useStore.getState()
    syncInstruments(project)

    const gen = ++playGenRef.current

    // 엔진을 매 play 시 재생성 (getInstrument 클로저가 최신 Map 참조)
    engineRef.current = createPlaybackEngine((trackId) => {
      return instrumentsRef.current.get(trackId) ?? null
    })

    void engineRef.current.play(
      project,
      () => {
        useStore.getState().setPlaying(false)
      },
      () => playGenRef.current === gen,
      // 녹음 중이면 keepAlive: 빈 트랙이어도 transport를 유지해 Stop 전까지 녹음 가능
      { keepAlive: isRecording },
    )
  }, [syncInstruments])

  const stop = useCallback(() => {
    playGenRef.current++
    // transport.stop()이 위치를 0으로 리셋하기 전에 현재 위치를 스냅샷.
    // 녹음 커밋 시 dangling 노트 마감 endSec 계산에 사용.
    const stopped = engineRef.current?.getSeconds() ?? 0
    useStore.getState().setRecordStopSec(stopped)
    engineRef.current?.stop()
  }, [])
  const getSeconds = useCallback(() => engineRef.current?.getSeconds() ?? 0, [])

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      playGenRef.current++
      engineRef.current?.stop()
      for (const inst of instrumentsRef.current.values()) inst.dispose()
      instrumentsRef.current.clear()
      presetCacheRef.current.clear()
    }
  }, [])

  return { play, stop, getSeconds }
}

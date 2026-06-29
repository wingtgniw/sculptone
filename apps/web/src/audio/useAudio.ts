import { useCallback, useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine } from './playback'
import { useStore } from '../state/store'

export function useAudio() {
  const engineRef = useRef<PlaybackEngine | null>(null)

  const ensureEngine = (): PlaybackEngine => {
    if (!engineRef.current) {
      const presetId = useStore.getState().project.tracks[0]?.sound
      const desc = getPreset(presetId && presetId.kind === 'preset' ? presetId.presetId : 'acoustic-piano')!
      const inst = createInstrument(descriptorToToneSpec(desc))
      engineRef.current = createPlaybackEngine(inst)
    }
    return engineRef.current
  }

  const play = useCallback(() => {
    const s = useStore.getState()
    void ensureEngine().play(s.project, s.selectedTrackId, () => useStore.getState().setPlaying(false))
  }, [])
  const stop = useCallback(() => engineRef.current?.stop(), [])
  const getSeconds = useCallback(() => engineRef.current?.getSeconds() ?? 0, [])

  return { play, stop, getSeconds }
}

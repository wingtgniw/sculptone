import * as Tone from 'tone'
import { createInstrumentFromSound, type SoundInput } from '@sculptone/sound-engine'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from '../audio/multitrack'
import type { Project } from '@sculptone/score-model'

/**
 * 리버브/딜레이 여운 여유 최솟값. 마지막 노트 끝 이후 최소 2초를 렌더에 추가한다.
 * AMT 학습에서 release tail을 포함하는 것이 중요.
 */
export const RENDER_TAIL_SEC = 2.0

/**
 * 가청 트랙의 리버브 decay를 고려한 렌더 tail 길이를 반환한다.
 * - patch 트랙의 reverb effects 중 가장 긴 decay + 0.5 초
 * - 항상 RENDER_TAIL_SEC 이상을 보장
 * - preset 트랙 또는 리버브 없는 트랙은 decay=0 으로 취급
 */
export function computeRenderTailSec(project: Project, audibleIds: string[]): number {
  let maxDecay = 0
  for (const trackId of audibleIds) {
    const track = project.tracks.find((t) => t.id === trackId)
    if (!track || track.sound.kind !== 'patch') continue
    for (const fx of track.sound.effects ?? []) {
      if (fx.type === 'reverb') {
        maxDecay = Math.max(maxDecay, fx.decay)
      }
    }
  }
  return Math.max(RENDER_TAIL_SEC, maxDecay + 0.5)
}

/**
 * 프로젝트를 Tone.Offline으로 렌더해 AudioBuffer를 반환한다.
 *
 * 로직은 playback.ts의 createPlaybackEngine.play와 동일:
 * - audibleTrackIds → buildMultiSchedule
 * - 트랙별 createInstrumentFromSound (offline context에서 재생성)
 * - triggerAttackRelease로 절대 시간에 스케줄
 *
 * 빈 프로젝트: contentEndSec=0 → durationSec=RENDER_TAIL_SEC → 무음 버퍼 반환.
 */
export async function renderProjectAudio(
  project: Project,
  opts: { sampleRate?: number } = {},
): Promise<AudioBuffer> {
  const { sampleRate = 44100 } = opts
  const audibleIds = audibleTrackIds(project)
  const items = buildMultiSchedule(project, audibleIds)

  const contentEndSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
  const tail = computeRenderTailSec(project, audibleIds)
  const durationSec = contentEndSec + tail

  const toneBuffer = await Tone.Offline(
    async () => {
      // ── 트랙별 악기 재생성 (offline context 자동 적용) ──────────────
      const instMap = new Map<string, ReturnType<typeof createInstrumentFromSound>>()
      for (const trackId of audibleIds) {
        const track = project.tracks.find((t) => t.id === trackId)
        if (!track) continue
        const inst = createInstrumentFromSound(track.sound as SoundInput)
        inst.volume.value = linearToDb(track.mixer.volume)
        instMap.set(trackId, inst)
      }

      // ── Fix A: 리버브 IR이 준비될 때까지 대기 ────────────────────────
      const readies = [...instMap.values()]
        .map((i) => i.ready)
        .filter((r): r is Promise<void> => r != null)
      if (readies.length > 0) {
        await Promise.all(readies)
      }

      // ── 노트 스케줄 (playback.ts와 동일 로직) ────────────────────────
      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        const note = Tone.Frequency(item.pitch, 'midi').toNote()
        inst.triggerAttackRelease(note, item.durationSec, item.timeSec, item.velocity)
      }
    },
    durationSec,
    2, // channels (스테레오)
    sampleRate,
  )

  const audioBuffer = toneBuffer.get()
  if (!audioBuffer) {
    throw new Error('[renderAudio] Tone.Offline returned no AudioBuffer')
  }
  return audioBuffer
}

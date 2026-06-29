import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'

export interface MultiScheduleItem {
  trackId: string
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

/**
 * 재생해야 할 트랙 ID 목록을 반환한다.
 * - soloed 트랙이 1개 이상이면 그 집합만.
 * - 없으면 muted 아닌 트랙 전체.
 */
export function audibleTrackIds(project: Project): string[] {
  const soloed = project.tracks.filter((t) => t.mixer.soloed)
  if (soloed.length > 0) return soloed.map((t) => t.id)
  return project.tracks.filter((t) => !t.mixer.muted).map((t) => t.id)
}

/**
 * audibleIds 트랙의 모든 노트를 절대 초(seconds) 기준 아이템으로 변환한다.
 * time.ts의 ticksToSeconds를 재사용.
 */
export function buildMultiSchedule(
  project: Project,
  audibleIds: string[],
): MultiScheduleItem[] {
  const { ppq, tempo } = project.transport
  const result: MultiScheduleItem[] = []
  for (const trackId of audibleIds) {
    const track = project.tracks.find((t) => t.id === trackId)
    if (!track) continue
    for (const n of track.notes) {
      result.push({
        trackId,
        timeSec: ticksToSeconds(n.start, ppq, tempo),
        durationSec: ticksToSeconds(n.duration, ppq, tempo),
        pitch: n.pitch,
        velocity: n.velocity / 127,
      })
    }
  }
  return result
}

/**
 * 0..1 선형 볼륨 → dB 변환.
 * v=0 또는 음수 → -Infinity (무음).
 */
export function linearToDb(v: number): number {
  if (v <= 0) return -Infinity
  return 20 * Math.log10(v)
}

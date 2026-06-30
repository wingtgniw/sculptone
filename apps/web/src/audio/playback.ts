import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from './multitrack'

// ── 기존 buildSchedule (단일 트랙) — backward compat, 테스트 보존 ──

export interface ScheduleItem {
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

export function buildSchedule(project: Project, trackId: string): ScheduleItem[] {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) return []
  const { ppq, tempo } = project.transport
  return track.notes.map((n) => ({
    timeSec: ticksToSeconds(n.start, ppq, tempo),
    durationSec: ticksToSeconds(n.duration, ppq, tempo),
    pitch: n.pitch,
    velocity: n.velocity / 127,
  }))
}

// ── 멀티트랙 재생 엔진 ─────────────────────────────────────────

export interface MultiInstrument {
  triggerAttackRelease: (note: string, dur: number, time: number, vel?: number) => void
  volume: { value: number }
}

/** play 옵션. keepAlive: 녹음 모드 — 노트가 없거나 끝나도 Stop 전까지 transport를 유지(자동종료 미등록). */
export interface PlayOptions {
  keepAlive?: boolean
}

export interface PlaybackEngine {
  /** 프로젝트 전체를 audibleTrackIds 기준으로 재생. onEnded: 마지막 노트 후 호출. isValid: cold-start 레이스 가드. */
  play: (
    project: Project,
    onEnded?: () => void,
    isValid?: () => boolean,
    opts?: PlayOptions,
  ) => Promise<void>
  stop: () => void
  getSeconds: () => number
}

/**
 * 멀티트랙 재생 엔진.
 * @param getInstrument trackId → MultiInstrument | null (null이면 해당 트랙 스킵)
 */
export function createPlaybackEngine(
  getInstrument: (trackId: string) => MultiInstrument | null,
): PlaybackEngine {
  const transport = Tone.getTransport()
  return {
    async play(project, onEnded, isValid, opts) {
      await Tone.start()
      // cold-start await 동안 stop/언마운트가 발생했으면 무시
      if (isValid && !isValid()) return
      transport.stop()
      transport.cancel()
      transport.bpm.value = project.transport.tempo

      const audibleIds = audibleTrackIds(project)
      const items = buildMultiSchedule(project, audibleIds)

      // play 시점에 audible 트랙별 instrument 가져오고 volume 적용
      const instMap = new Map<string, MultiInstrument>()
      for (const trackId of audibleIds) {
        const inst = getInstrument(trackId)
        if (!inst) continue
        const track = project.tracks.find((t) => t.id === trackId)
        if (track) inst.volume.value = linearToDb(track.mixer.volume)
        instMap.set(trackId, inst)
      }

      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          inst.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, item.timeSec)
      }

      const endSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
      if (opts?.keepAlive) {
        // 녹음 모드: 빈 트랙(endSec===0)이어도 transport를 시작해 Stop 전까지 유지.
        // 자동종료(scheduleOnce)/onEnded를 등록하지 않는다 — 사용자가 Stop할 때까지 녹음 지속.
        transport.start()
      } else if (endSec > 0) {
        transport.scheduleOnce(() => {
          transport.stop()
          transport.cancel()
          onEnded?.()
        }, endSec)
        transport.start()
      } else {
        transport.stop()
        transport.cancel()
        onEnded?.()
      }
    },
    stop() {
      transport.stop()
      transport.cancel()
    },
    getSeconds() {
      return transport.seconds
    },
  }
}

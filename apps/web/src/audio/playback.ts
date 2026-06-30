import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from './multitrack'
import { computeClickTimes, beatDurationSec, type MetronomeHandle } from './metronome'

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

/**
 * play 옵션.
 * - keepAlive: 녹음 모드 — 노트가 없거나 끝나도 Stop 전까지 transport를 유지.
 * - metronome: 재생 구간 전체 박에 클릭 이벤트를 스케줄한다.
 * - countInDurationSec: > 0이면 content 노트를 이 값만큼 오프셋.
 * - loopEnabled: true이면 transport.loop=true + setLoopPoints. keepAlive 시 강제 false(녹음 가드).
 * - loopStartTicks: 루프 시작(틱). loopEnabled=true 시 사용.
 * - loopEndTicks: 루프 종료(틱). loopEnabled=true 시 사용.
 */
export interface PlayOptions {
  keepAlive?: boolean
  metronome?: MetronomeHandle
  countInDurationSec?: number
  loopEnabled?: boolean
  loopStartTicks?: number
  loopEndTicks?: number
}

export interface PlaybackEngine {
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
      if (isValid && !isValid()) return
      transport.stop()
      transport.cancel()
      transport.bpm.value = project.transport.tempo

      const { ppq, tempo } = project.transport
      const countInDurationSec = opts?.countInDurationSec ?? 0
      const metronome = opts?.metronome

      // ── 녹음 가드: keepAlive(녹음 모드) 중에는 루프 강제 비활성 ──
      // 녹음 타이밍(recordingContentStartSec)이 루프 반복으로 어긋나지 않도록 보호.
      const effectiveLoopEnabled = (opts?.loopEnabled ?? false) && !(opts?.keepAlive ?? false)

      // #fix1: loopStartSec를 블록 밖으로 호이스트 — start() offset에 사용
      const loopStartSec = ticksToSeconds(opts?.loopStartTicks ?? 0, ppq, tempo)

      if (effectiveLoopEnabled) {
        const loopEndSec = ticksToSeconds(opts?.loopEndTicks ?? 0, ppq, tempo)
        transport.loop = true
        transport.setLoopPoints(loopStartSec, loopEndSec)
      } else {
        // 이전 play에서 loop=true였을 경우를 위해 항상 리셋
        transport.loop = false
      }

      const audibleIds = audibleTrackIds(project)
      const items = buildMultiSchedule(project, audibleIds)

      const instMap = new Map<string, MultiInstrument>()
      for (const trackId of audibleIds) {
        const inst = getInstrument(trackId)
        if (!inst) continue
        const track = project.tracks.find((t) => t.id === trackId)
        if (track) inst.volume.value = linearToDb(track.mixer.volume)
        instMap.set(trackId, inst)
      }

      // 노트 스케줄: countInDurationSec만큼 오프셋
      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        const scheduledAt = item.timeSec + countInDurationSec
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          inst.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, scheduledAt)
      }

      const contentEndSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
      const totalDurationSec = countInDurationSec + contentEndSec

      // ── 메트로놈 클릭 스케줄 ──────────────────────────────────
      // keepAlive(녹음) 또는 루프 모드: scheduleRepeat로 무한 연속 클릭.
      // 유한 재생: computeClickTimes + schedule로 구간 내 클릭만 등록.
      if (metronome) {
        if (opts?.keepAlive || effectiveLoopEnabled) {
          const beatDur = beatDurationSec(tempo)
          const beatsPerBar = (project.transport.timeSignature as [number, number])[0]
          let beatIndex = 0
          transport.scheduleRepeat(
            (time) => {
              metronome.click(time, beatIndex % beatsPerBar === 0)
              beatIndex++
            },
            beatDur,
            0,
          )
        } else if (totalDurationSec > 0) {
          const clicks = computeClickTimes(
            tempo,
            project.transport.timeSignature as [number, number],
            0,
            totalDurationSec,
          )
          for (const click of clicks) {
            transport.schedule((time) => {
              metronome.click(time, click.accent)
            }, click.timeSec)
          }
        }
      }

      const endSec = totalDurationSec

      // #fix1: effectiveLoopEnabled이면 loopStartSec offset으로 재생 시작
      //        keepAlive이면 offset 없이 시작 (녹음 모드)
      if (effectiveLoopEnabled) {
        transport.start(undefined, loopStartSec)
      } else if (opts?.keepAlive) {
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

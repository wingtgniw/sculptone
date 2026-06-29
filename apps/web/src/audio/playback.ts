import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'

export interface ScheduleItem {
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

// 순수: 트랙 노트를 절대 초(seconds) 스케줄로 변환
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

export interface PlaybackEngine {
  play: (project: Project, trackId: string, onEnded?: () => void) => Promise<void>
  stop: () => void
  getSeconds: () => number
}

// 비순수: Tone Transport로 스케줄 재생. instrument는 주입(테스트/교체 용이).
export function createPlaybackEngine(
  instrument: { triggerAttackRelease: (note: string, dur: number, time: number, vel?: number) => void },
): PlaybackEngine {
  const transport = Tone.getTransport()
  return {
    async play(project, trackId, onEnded) {
      await Tone.start()
      transport.stop()
      transport.cancel()
      transport.bpm.value = project.transport.tempo
      const items = buildSchedule(project, trackId)
      for (const item of items) {
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          instrument.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, item.timeSec)
      }
      const endSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
      if (endSec > 0) {
        transport.scheduleOnce(() => { transport.stop(); transport.cancel(); onEnded?.() }, endSec)
      }
      transport.start()
    },
    stop() { transport.stop(); transport.cancel() },
    getSeconds() { return transport.seconds },
  }
}

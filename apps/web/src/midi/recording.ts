import { secondsToTicks } from '../compose/time'
import { divisionToTicks, snap } from '../compose/quantize'
import type { Note } from '@sculptone/score-model'

export interface RawMidiEvent {
  kind: 'noteon' | 'noteoff'
  pitch: number
  velocity: number
  timeSec: number // 녹음 시작 기준 상대 초
}

export interface RecordingContext {
  ppq: number
  tempo: number
  quantizeDenom: number // 0 또는 음수 → 양자화 없음(snap 스킵)
  endSec: number // 녹음 종료 시점(상대 초). dangling noteon 마감에 사용.
}

/**
 * MIDI noteon/noteoff 이벤트 배열을 Note 데이터 배열로 변환한다.
 *
 * - pitch별 FIFO 큐로 noteon↔noteoff 매칭.
 * - dangling noteoff (매칭 noteon 없음) → 스킵.
 * - dangling noteon (매칭 noteoff 없음) → endSec로 마감.
 * - start: secondsToTicks(timeSec) 후 snap(gridTicks)로 양자화.
 * - duration: Math.max(1, Math.round(secondsToTicks(durSec))). 최소 1 tick.
 * - 결과를 start 오름차순으로 정렬.
 *
 * 반환 타입이 Omit<Note, 'id'>인 이유: createNote()로 id를 생성해 addNote에 전달.
 */
export function recordedEventsToNotes(
  events: RawMidiEvent[],
  ctx: RecordingContext,
): Array<Omit<Note, 'id'>> {
  const { ppq, tempo, quantizeDenom, endSec } = ctx
  const gridTicks = quantizeDenom > 0 ? divisionToTicks(quantizeDenom, ppq) : 0

  // pitch → 활성 noteon 큐 (FIFO)
  const active = new Map<number, Array<{ timeSec: number; velocity: number }>>()
  const results: Array<Omit<Note, 'id'>> = []

  for (const ev of events) {
    if (ev.kind === 'noteon') {
      if (!active.has(ev.pitch)) active.set(ev.pitch, [])
      active.get(ev.pitch)!.push({ timeSec: ev.timeSec, velocity: ev.velocity })
    } else {
      // noteoff
      const queue = active.get(ev.pitch)
      if (!queue || queue.length === 0) continue // dangling noteoff → 스킵
      const on = queue.shift()!
      const durSec = ev.timeSec - on.timeSec
      if (durSec <= 0) {
        // 동시 입력 방어: duration 1 tick 보장
        const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
        const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
        results.push({ pitch: ev.pitch, start, duration: 1, velocity: on.velocity })
        continue
      }
      const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
      const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
      const duration = Math.max(1, Math.round(secondsToTicks(durSec, ppq, tempo)))
      results.push({ pitch: ev.pitch, start, duration, velocity: on.velocity })
    }
  }

  // dangling noteon → endSec로 마감
  for (const [pitch, queue] of active.entries()) {
    for (const on of queue) {
      const durSec = endSec - on.timeSec
      if (durSec <= 0) continue // endSec 이전 입력이 없으면 스킵
      const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
      const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
      const duration = Math.max(1, Math.round(secondsToTicks(durSec, ppq, tempo)))
      results.push({ pitch, start, duration, velocity: on.velocity })
    }
  }

  // start 오름차순 정렬
  results.sort((a, b) => a.start - b.start)

  return results
}

/**
 * Step input 모드 커서 전진 헬퍼.
 * cursorTick에서 gridTicks만큼 이동한 다음 위치를 반환한다.
 */
export function stepInsert(cursorTick: number, gridTicks: number): number {
  return cursorTick + gridTicks
}

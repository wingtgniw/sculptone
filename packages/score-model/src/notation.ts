import type { Track, Transport } from './schema'

// ── 공개 타입 ─────────────────────────────────────────────────

export type DurationType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th'

export interface NotationNote {
  kind: 'note'
  pitches: number[]        // MIDI pitches (오름차순). 1개=단음, 2+개=화음.
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // 실제 tick 길이 (MusicXML <duration> 용)
  tie?: 'start' | 'stop' | 'startstop'
}

export interface NotationRest {
  kind: 'rest'
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // 실제 gap tick 길이 (MusicXML <duration> 용)
}

export type NotationElement = NotationNote | NotationRest

export interface NotationMeasure {
  elements: NotationElement[]
}

export interface TrackNotation {
  measures: NotationMeasure[]
}

export interface DurationSpec {
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // canonical tick count (ppq 기준)
}

// ── 내부 타입 ──────────────────────────────────────────────────

interface ChordEvent {
  start: number
  duration: number
  pitches: number[]
  tie?: 'start' | 'stop' | 'startstop'
}

// ── 순수 헬퍼 함수 ─────────────────────────────────────────────

/**
 * MIDI pitch → 옥타브 번호 (표준 MIDI 규약: MIDI 60 = C4, MIDI 0 = C-1).
 *
 * @public
 */
export function midiToOctave(pitch: number): number {
  return Math.floor(pitch / 12) - 1
}

/**
 * 주어진 ppq에서 지원하는 모든 표준 duration을 반환한다 (ticks 오름차순).
 * dotted-whole(ppq*6)도 포함 — 6/4 등 큰 박자 마디 전체 표기용, 4/4에선 선택 대상 안 됨.
 */
function buildDurationTable(ppq: number): DurationSpec[] {
  const base: Array<[DurationType, number]> = [
    ['16th',    ppq / 4],
    ['eighth',  ppq / 2],
    ['quarter', ppq],
    ['half',    ppq * 2],
    ['whole',   ppq * 4],
  ]
  const result: DurationSpec[] = []
  for (const [durationType, t] of base) {
    result.push({ durationType, dots: 0, ticks: t })
    result.push({ durationType, dots: 1, ticks: t * 1.5 })
  }
  return result.sort((a, b) => a.ticks - b.ticks)
}

/**
 * tick 길이를 가장 가까운 표준 duration spec으로 매핑한다.
 * 거리 동일 시 더 짧은(보수적) 쪽 우선.
 *
 * @public
 */
export function ticksToDurationType(ticks: number, ppq: number): DurationSpec {
  const table = buildDurationTable(ppq)

  // 정확 일치 우선 (부동소수점 오차 ±0.5 허용)
  for (const spec of table) {
    if (Math.abs(spec.ticks - ticks) < 0.5) return spec
  }

  // 최근접 검색 (거리 동일 시 더 짧은 쪽)
  let best = table[0]!
  let bestDist = Math.abs(table[0]!.ticks - ticks)
  for (const spec of table) {
    const dist = Math.abs(spec.ticks - ticks)
    if (dist < bestDist || (dist === bestDist && spec.ticks < best.ticks)) {
      bestDist = dist
      best = spec
    }
  }
  return best
}

/**
 * 노트 배열을 단성 화음 이벤트 배열로 변환한다.
 *
 * 규칙:
 * 1. start 오름차순 정렬 (동률 시 pitch 오름차순).
 * 2. 동일 start 노트 → 화음 그룹 (pitches 오름차순). end = max(start+duration).
 * 3. 인접 화음 오버랩 시 앞 화음 duration을 다음 화음 start까지 클리핑.
 * 4. 클리핑 후 duration <= 0이면 해당 화음 제외.
 *
 * @public
 */
export function flattenToChords(
  notes: ReadonlyArray<{ pitch: number; start: number; duration: number }>,
): ChordEvent[] {
  if (notes.length === 0) return []

  // 정렬
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)

  // 화음 그룹핑
  const grouped: Array<{ start: number; end: number; pitches: number[] }> = []
  for (const n of sorted) {
    const last = grouped[grouped.length - 1]
    if (last && last.start === n.start) {
      // E: 정렬 상 동일 pitch는 인접 — 마지막과 다를 때만 push (dedup)
      if (last.pitches.at(-1) !== n.pitch) last.pitches.push(n.pitch)
      last.end = Math.max(last.end, n.start + n.duration)
    } else {
      grouped.push({ start: n.start, end: n.start + n.duration, pitches: [n.pitch] })
    }
  }

  // 오버랩 해소
  const result: ChordEvent[] = []
  for (let i = 0; i < grouped.length; i++) {
    const cur = grouped[i]!
    const next = grouped[i + 1]
    let duration = cur.end - cur.start
    if (next && cur.end > next.start) {
      duration = next.start - cur.start
    }
    if (duration <= 0) continue
    result.push({ start: cur.start, duration, pitches: cur.pitches })
  }
  return result
}

/**
 * 화음 이벤트 배열을 마디 경계에서 분할하고 타이를 부여한다.
 *
 * @returns 마디별 ChordEvent 배열 (인덱스 = 마디 번호)
 * @public
 */
export function splitAtBarlines(
  chords: ChordEvent[],
  measureTicks: number,
): ChordEvent[][] {
  if (chords.length === 0) return []

  const lastEnd = chords.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const numMeasures = Math.max(1, Math.ceil(lastEnd / measureTicks))
  const measures: ChordEvent[][] = Array.from({ length: numMeasures }, () => [])

  for (const chord of chords) {
    let remaining = chord.duration
    let currentStart = chord.start
    let isFirstPart = true

    while (remaining > 0) {
      const measureIdx = Math.floor(currentStart / measureTicks)
      if (measureIdx >= numMeasures) break

      const measureEnd = (measureIdx + 1) * measureTicks
      const portionDur = Math.min(remaining, measureEnd - currentStart)
      const isLastPart = portionDur >= remaining

      let tie: ChordEvent['tie'] = undefined
      if (isFirstPart && !isLastPart) tie = 'start'
      else if (!isFirstPart && !isLastPart) tie = 'startstop'
      else if (!isFirstPart && isLastPart) tie = 'stop'
      // isFirstPart && isLastPart → 타이 없음

      measures[measureIdx]!.push({
        start: currentStart,
        duration: portionDur,
        pitches: chord.pitches,
        ...(tie !== undefined ? { tie } : {}),
      })

      currentStart = measureEnd
      remaining -= portionDur
      isFirstPart = false
    }
  }

  return measures
}

/**
 * 마디 내 화음 이벤트 배열에 쉼표를 삽입해 NotationElement[] 로 변환한다.
 *
 * - cursor는 chord.start로 점프(gap 표시 후 실제 위치 유지).
 * - 끝 부분 gap이 있으면 rest 추가.
 *
 * @public
 */
export function fillRests(
  chords: ChordEvent[],
  measureStart: number,
  measureEnd: number,
  ppq: number,
): NotationElement[] {
  const elements: NotationElement[] = []
  let cursor = measureStart

  const sorted = [...chords].sort((a, b) => a.start - b.start)

  for (const chord of sorted) {
    if (chord.start > cursor) {
      const gapTicks = chord.start - cursor
      const spec = ticksToDurationType(gapTicks, ppq)
      elements.push({ kind: 'rest', durationType: spec.durationType, dots: spec.dots, ticks: gapTicks })
      cursor = chord.start // 실제 위치로 점프 (spec.ticks 아님 — 정렬 유지)
    }

    const spec = ticksToDurationType(chord.duration, ppq)
    const noteEl: NotationNote = {
      kind: 'note',
      pitches: chord.pitches,
      durationType: spec.durationType,
      dots: spec.dots,
      ticks: chord.duration,
    }
    if (chord.tie !== undefined) noteEl.tie = chord.tie
    elements.push(noteEl)
    cursor = chord.start + chord.duration
  }

  // 마디 끝 gap
  if (cursor < measureEnd) {
    const gapTicks = measureEnd - cursor
    const spec = ticksToDurationType(gapTicks, ppq)
    elements.push({ kind: 'rest', durationType: spec.durationType, dots: spec.dots, ticks: gapTicks })
  }

  return elements
}

/**
 * Track의 노트를 악보 기보 구조로 변환한다 (순수 함수, 저장 안 함).
 *
 * @param track - { notes } (id 불필요)
 * @param transport - { ppq, tempo, timeSignature, key }
 * @public
 */
export function trackToNotation(
  track: Pick<Track, 'notes'>,
  transport: Pick<Transport, 'ppq' | 'timeSignature'>,
): TrackNotation {
  if (track.notes.length === 0) return { measures: [] }

  const { ppq, timeSignature } = transport
  const [numerator, denominator] = timeSignature
  const measureTicks = (ppq * 4 * numerator) / denominator

  // 1. 단성 화음 평탄화
  const chords = flattenToChords(track.notes)

  // 2. 마디 분할 + 타이 부여
  const perMeasure = splitAtBarlines(chords, measureTicks)

  // 3. 쉼표 삽입 + NotationElement 변환
  const measures: NotationMeasure[] = perMeasure.map((measureChords, idx) => {
    const measureStart = idx * measureTicks
    const measureEnd = (idx + 1) * measureTicks
    const elements = fillRests(measureChords, measureStart, measureEnd, ppq)
    return { elements }
  })

  return { measures }
}

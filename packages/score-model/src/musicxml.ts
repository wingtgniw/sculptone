import type { Project } from './schema'
import { trackToNotation, fillRests, midiToOctave } from './notation'
import type { NotationNote, NotationRest, NotationElement, DurationType } from './notation'

// ── 내부 헬퍼 ──────────────────────────────────────────────────

/** MIDI pitch class → MusicXML step / alter */
const PC_STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'] as const
const PC_ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] as const

function midiToXml(pitch: number): { step: string; octave: number; alter: number } {
  const pc = ((pitch % 12) + 12) % 12
  const octave = midiToOctave(pitch) // C: 공유 헬퍼 사용
  return { step: PC_STEP[pc]!, octave, alter: PC_ALTER[pc]! }
}

/** project.transport.key → MusicXML fifths (C major = 0 기본) */
function keyToFifths(key: string): number {
  const MAP: Record<string, number> = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    'F#': 6,
    'C#': 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
    Cb: -7,
  }
  return MAP[key] ?? 0
}

/** XML 특수문자 이스케이프 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** NotationRest → <note> XML 문자열 */
function renderRest(el: NotationRest): string {
  const lines = [
    '      <note>',
    '        <rest/>',
    `        <duration>${el.ticks}</duration>`,
    `        <type>${el.durationType}</type>`,
    ...(el.dots > 0 ? ['        <dot/>'] : []),
    '      </note>',
  ]
  return lines.join('\n')
}

/** 단일 pitch + NotationNote 메타 → <note> XML 문자열 */
function renderPitch(pitch: number, el: NotationNote, isChordContinuation: boolean): string {
  const { step, octave, alter } = midiToXml(pitch)
  const lines = ['      <note>']
  if (isChordContinuation) lines.push('        <chord/>')
  lines.push(
    '        <pitch>',
    `          <step>${step}</step>`,
    ...(alter !== 0 ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    `        <duration>${el.ticks}</duration>`,
  )

  // Tie elements (attribute on note, before type)
  if (el.tie === 'start' || el.tie === 'startstop') {
    lines.push('        <tie type="start"/>')
  }
  if (el.tie === 'stop' || el.tie === 'startstop') {
    lines.push('        <tie type="stop"/>')
  }

  lines.push(`        <type>${el.durationType}</type>`)
  if (el.dots > 0) lines.push('        <dot/>')

  // Notations for tied elements
  if (el.tie) {
    lines.push('        <notations>')
    if (el.tie === 'start' || el.tie === 'startstop') {
      lines.push('          <tied type="start"/>')
    }
    if (el.tie === 'stop' || el.tie === 'startstop') {
      lines.push('          <tied type="stop"/>')
    }
    lines.push('        </notations>')
  }

  lines.push('      </note>')
  return lines.join('\n')
}

// ── 공개 API ──────────────────────────────────────────────────

// ── 내부: 마디 요소 XML 렌더 ──────────────────────────────────

function renderElements(elements: NotationElement[], mLines: string[]): void {
  for (const el of elements) {
    if (el.kind === 'rest') {
      mLines.push(renderRest(el))
    } else {
      // NotationNote: pitches[] → 첫 음은 주 note, 이후는 chord continuation
      for (let ki = 0; ki < el.pitches.length; ki++) {
        mLines.push(renderPitch(el.pitches[ki]!, el, ki > 0))
      }
    }
  }
}

function renderAttributes(
  ppq: number,
  fifths: number,
  numerator: number,
  denominator: number,
): string[] {
  return [
    '      <attributes>',
    `        <divisions>${ppq}</divisions>`,
    '        <key>',
    `          <fifths>${fifths}</fifths>`,
    '        </key>',
    '        <time>',
    `          <beats>${numerator}</beats>`,
    `          <beat-type>${denominator}</beat-type>`,
    '        </time>',
    '        <clef>',
    '          <sign>G</sign>',
    '          <line>2</line>',
    '        </clef>',
    '      </attributes>',
  ]
}

/**
 * Project → MusicXML 3.1 partwise 문자열 (순수 함수, 저장 안 함).
 *
 * - <divisions> = ppq (quarter note = ppq divisions).
 * - <key><fifths>: project.transport.key 기반 단순 매핑, 미지 키는 0(C major).
 * - <clef>: G 보표 고정.
 * - 화음(동일 start): 두 번째 음부터 <chord/> 삽입.
 * - 타이: <tie type="start|stop"/> + <notations><tied .../></notations>.
 * - <duration> = el.ticks (실제 tick 값). <type>은 근사 표시용.
 * - 빈 트랙: 전마디 쉼표 1마디를 내보냄 (DTD: part(measure+)).
 * - 트랙 0개: 최소 1 합성 part를 내보냄 (DTD: part-list(score-part+)).
 */
export function projectToMusicXML(project: Project): string {
  const { ppq, timeSignature, key } = project.transport
  const [numerator, denominator] = timeSignature
  const fifths = keyToFifths(key)
  const measureTicks = (ppq * 4 * numerator) / denominator

  // B: zero-track guard — DTD requires at least 1 score-part and 1 part(measure+)
  if (project.tracks.length === 0) {
    const restEls = fillRests([], 0, measureTicks, ppq)
    const mLines = ['    <measure number="1">']
    mLines.push(...renderAttributes(ppq, fifths, numerator, denominator))
    renderElements(restEls, mLines)
    mLines.push('    </measure>')
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
      '<score-partwise version="3.1">',
      '  <part-list>',
      '    <score-part id="P1">\n      <part-name></part-name>\n    </score-part>',
      '  </part-list>',
      `  <part id="P1">\n${mLines.join('\n')}\n  </part>`,
      '</score-partwise>',
    ].join('\n')
  }

  const partListItems: string[] = []
  const partItems: string[] = []

  for (let pi = 0; pi < project.tracks.length; pi++) {
    const track = project.tracks[pi]!
    const partId = `P${pi + 1}`

    partListItems.push(
      `    <score-part id="${partId}">\n      <part-name>${escapeXml(track.name)}</part-name>\n    </score-part>`,
    )

    const notation = trackToNotation(track, project.transport)
    // A: 빈 트랙 → 전마디 쉼표 1마디 폴백 (DTD: part(measure+))
    const measures =
      notation.measures.length > 0
        ? notation.measures
        : [{ elements: fillRests([], 0, measureTicks, ppq) }]

    const measureLines: string[] = []
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi]!
      const mLines = [`    <measure number="${mi + 1}">`]

      // 첫 마디 attributes
      if (mi === 0) {
        mLines.push(...renderAttributes(ppq, fifths, numerator, denominator))
      }

      renderElements(measure.elements, mLines)
      mLines.push('    </measure>')
      measureLines.push(mLines.join('\n'))
    }

    partItems.push(`  <part id="${partId}">\n${measureLines.join('\n')}\n  </part>`)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    '  <part-list>',
    partListItems.join('\n'),
    '  </part-list>',
    partItems.join('\n'),
    '</score-partwise>',
  ].join('\n')
}

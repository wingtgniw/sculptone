import { describe, it, expect } from 'vitest'
import { projectToMusicXML } from '../src/musicxml'
import { createEmptyProject, createTrack, createNote, addTrack, addNote } from '../src'

// ── 헬퍼 ──────────────────────────────────────────────────────

function countTag(xml: string, tag: string): number {
  // <tag> 혹은 <tag/> 시작 카운트
  const re = new RegExp(`<${tag}[\\s/>]`, 'g')
  return (xml.match(re) ?? []).length
}

function makeProject(
  notes: Array<{ pitch: number; start: number; duration: number; velocity: number }> = [],
) {
  const t = createTrack('Piano')
  let p = addTrack(createEmptyProject('Test'), t)
  for (const n of notes) {
    p = addNote(p, t.id, createNote(n))
  }
  return p
}

// ── 기본 구조 ──────────────────────────────────────────────────

describe('projectToMusicXML — 기본 구조', () => {
  it('score-partwise 루트 엘리먼트와 버전 3.1이 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<score-partwise version="3.1">')
    expect(xml).toContain('</score-partwise>')
  })

  it('DOCTYPE 선언이 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<!DOCTYPE score-partwise')
  })

  it('part-list와 score-part가 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<part-list>')
    expect(xml).toContain('<score-part id="P1">')
    expect(xml).toContain('<part-name>Piano</part-name>')
  })

  it('노트 없는 트랙 → part 있음, 쉼표 1마디 포함(DTD: part(measure+))', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<part id="P1">')
    expect(countTag(xml, 'measure')).toBeGreaterThanOrEqual(1)
    expect(xml).toContain('<rest/>')
  })
})

// ── 첫 마디 attributes ─────────────────────────────────────────

describe('projectToMusicXML — 첫 마디 attributes', () => {
  it('첫 마디에 divisions(=ppq), key, time, clef가 포함된다', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<divisions>480</divisions>')
    expect(xml).toContain('<fifths>0</fifths>')
    expect(xml).toContain('<beats>4</beats>')
    expect(xml).toContain('<beat-type>4</beat-type>')
    expect(xml).toContain('<sign>G</sign>')
  })
})

// ── 노트 직렬화 ────────────────────────────────────────────────

describe('projectToMusicXML — note 직렬화', () => {
  it('quarter 노트(C4=60) → step:C, octave:4, duration:480, type:quarter', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<step>C</step>')
    expect(xml).toContain('<octave>4</octave>')
    expect(xml).toContain('<duration>480</duration>')
    expect(xml).toContain('<type>quarter</type>')
  })

  it('# 음(C#4=61) → step:C, alter:1, octave:4', () => {
    const notes = [{ pitch: 61, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<step>C</step>')
    expect(xml).toContain('<alter>1</alter>')
    expect(xml).toContain('<octave>4</octave>')
  })

  it('쉼표 → <rest/> 포함', () => {
    // quarter note at beat 2, beat 1 is a rest
    const notes = [{ pitch: 60, start: 480, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<rest/>')
  })

  it('화음(같은 start) → 두 번째 음에 <chord/> 포함', () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('Test'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    p = addNote(p, t.id, createNote({ pitch: 64, start: 0, duration: 480, velocity: 80 }))
    const xml = projectToMusicXML(p)
    expect(xml).toContain('<chord/>')
    // 두 note 엘리먼트 존재
    expect(countTag(xml, 'note')).toBeGreaterThanOrEqual(2)
  })

  it('점음표 → <dot/> 포함', () => {
    // dotted-quarter = 720 ticks
    const notes = [{ pitch: 60, start: 0, duration: 720, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<dot/>')
  })

  it('마디 넘는 노트 → <tie type="start"/> 와 <tie type="stop"/> 존재', () => {
    // note at tick 1680, duration 480 → crosses barline at 1920
    const notes = [{ pitch: 60, start: 1680, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<tie type="start"/>')
    expect(xml).toContain('<tie type="stop"/>')
    expect(xml).toContain('<tied type="start"/>')
    expect(xml).toContain('<tied type="stop"/>')
  })
})

// ── 멀티트랙 ──────────────────────────────────────────────────

describe('projectToMusicXML — 멀티트랙', () => {
  it('트랙 2개 → part P1, P2 모두 포함', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('Test'), t1), t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    const xml = projectToMusicXML(p)
    expect(xml).toContain('<score-part id="P1">')
    expect(xml).toContain('<score-part id="P2">')
    expect(xml).toContain('<part id="P1">')
    expect(xml).toContain('<part id="P2">')
  })
})

// ── B: 트랙 없는 프로젝트 (zero-track guard) ──────────────────

describe('projectToMusicXML — 트랙 없는 프로젝트', () => {
  it('트랙이 없는 프로젝트 → 유효 XML, score-part 1개, part 1개, measure 1개, whole-rest', () => {
    const xml = projectToMusicXML(createEmptyProject('Empty'))
    expect(xml).toContain('<score-partwise version="3.1">')
    expect(countTag(xml, 'score-part')).toBe(1)
    expect(countTag(xml, 'part')).toBe(1)
    expect(countTag(xml, 'measure')).toBeGreaterThanOrEqual(1)
    expect(xml).toContain('<rest/>')
  })
})

// ── F: 비표준 duration 회귀 ───────────────────────────────────

describe('projectToMusicXML — 비표준 duration 회귀', () => {
  it('duration:500 노트 → <duration>500</duration> 과 <type> 동시 존재 (ticks 정본 설계)', () => {
    const notes = [{ pitch: 60, start: 0, duration: 500, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<duration>500</duration>')
    expect(xml).toContain('<type>')
  })
})

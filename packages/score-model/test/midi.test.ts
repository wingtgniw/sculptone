import { describe, it, expect } from 'vitest'
import { Midi } from '@tonejs/midi'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addTrack, addNote } from '../src/operations'
import { projectToMidi, midiToProject } from '../src/midi'

function sampleProject() {
  const t = createTrack('Piano')
  const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  const n2 = createNote({ pitch: 64, start: 480, duration: 240, velocity: 80 })
  let p = addTrack(createEmptyProject('Test MIDI'), t)
  p = addNote(p, t.id, n1)
  p = addNote(p, t.id, n2)
  return { p, t, n1, n2 }
}

describe('projectToMidi', () => {
  it('Uint8Array를 반환한다', () => {
    const { p } = sampleProject()
    const bytes = projectToMidi(p)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('PPQ와 템포를 헤더에 기록한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    expect(midi.header.ppq).toBe(480)
    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(120, 4)
  })

  it('트랙 수와 노트 수가 일치한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    expect(midi.tracks).toHaveLength(1)
    expect(midi.tracks[0]!.notes).toHaveLength(2)
  })

  it('노트 pitch · ticks · durationTicks · velocity를 기록한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    const note = midi.tracks[0]!.notes.find((x) => x.ticks === 0)!
    expect(note.midi).toBe(60)
    expect(note.durationTicks).toBe(480)
    expect(note.velocity).toBeCloseTo(96 / 127, 3)
  })

  it('빈 프로젝트(트랙 없음)도 유효한 MIDI를 반환한다', () => {
    const p = createEmptyProject('Empty')
    const bytes = projectToMidi(p)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const midi = new Midi(bytes)
    expect(midi.tracks).toHaveLength(0)
  })

  it('비기본 ppq(960)·tempo(140)를 헤더에 기록한다', () => {
    let p = createEmptyProject('NonDefault')
    p = { ...p, transport: { ...p.transport, ppq: 960, tempo: 140 } }
    p = addTrack(p, createTrack('Piano'))
    const midi = new Midi(projectToMidi(p))
    expect(midi.header.ppq).toBe(960)
    // MIDI tempo는 microsecondsPerBeat(정수) 저장으로 미세 반올림 손실이 있다(140 → 140.00014).
    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(140, 2)
  })
})

describe('midiToProject', () => {
  it('bytes를 Project로 파싱한다 (트랙·노트 수)', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), 'Test MIDI')
    expect(restored.transport.ppq).toBe(480)
    expect(restored.transport.tempo).toBeCloseTo(120, 4)
    expect(restored.tracks).toHaveLength(1)
    expect(restored.tracks[0]!.notes).toHaveLength(2)
  })

  it('title 인수가 metadata.title에 반영된다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), 'My Import')
    expect(restored.metadata.title).toBe('My Import')
  })

  it('title 생략 시 "Imported"가 기본값이다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p))
    expect(restored.metadata.title).toBe('Imported')
  })

  it('빈 MIDI(트랙 없음)는 track=[] 프로젝트로 파싱된다', () => {
    const emptyMidi = new Midi()
    emptyMidi.header.fromJSON({ ...emptyMidi.header.toJSON(), ppq: 960 })
    const bytes = new Uint8Array(emptyMidi.toArray())
    const restored = midiToProject(bytes)
    expect(restored.tracks).toHaveLength(0)
    expect(restored.transport.ppq).toBe(960)
  })

  it('velocity 0 노트도 export→import에서 보존되며 velocity 1로 복원된다', () => {
    const t = createTrack('Zero')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 0 })
    const p = addNote(addTrack(createEmptyProject('Zero'), t), t.id, n)
    const restored = midiToProject(projectToMidi(p))
    // note-on velocity 0 으로 인한 노트 소실이 없어야 한다
    expect(restored.tracks[0]!.notes).toHaveLength(1)
    expect(restored.tracks[0]!.notes[0]!.velocity).toBe(1)
  })

  it('3/4 박자(timeSignature)가 round-trip에서 보존된다', () => {
    const t = createTrack('Waltz')
    let p = createEmptyProject('Waltz')
    p = { ...p, transport: { ...p.transport, timeSignature: [3, 4] } }
    p = addNote(
      addTrack(p, t),
      t.id,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    const restored = midiToProject(projectToMidi(p))
    expect(restored.transport.timeSignature).toEqual([3, 4])
  })

  it('velocity 0–127 정수가 round-trip 후 동일하다', () => {
    const t = createTrack('V')
    const notes = [1, 64, 96, 127].map((v) =>
      createNote({ pitch: 60, start: 0, duration: 480, velocity: v }),
    )
    let p = addTrack(createEmptyProject('V'), t)
    for (const n of notes) p = addNote(p, t.id, n)
    const restored = midiToProject(projectToMidi(p))
    const origVel = notes.map((n) => n.velocity)
    const resVel = restored.tracks[0]!.notes.map((n) => n.velocity)
    expect(resVel.sort()).toEqual(origVel.sort())
  })
})

describe('MIDI 라운드트립', () => {
  it('단일 트랙: pitch·start·duration·velocity·tempo·ppq가 보존된다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), p.metadata.title)

    // transport
    expect(restored.transport.ppq).toBe(p.transport.ppq)
    expect(restored.transport.tempo).toBeCloseTo(p.transport.tempo, 4)

    // 트랙 수
    expect(restored.tracks).toHaveLength(p.tracks.length)

    // 노트 비교 (ticks 순 정렬로 순서 보장)
    const origNotes = [...p.tracks[0]!.notes].sort((a, b) => a.start - b.start)
    const resNotes = [...restored.tracks[0]!.notes].sort((a, b) => a.start - b.start)
    expect(resNotes).toHaveLength(origNotes.length)

    for (let i = 0; i < origNotes.length; i++) {
      const o = origNotes[i]!
      const r = resNotes[i]!
      expect(r.pitch).toBe(o.pitch) // 정수 → 무손실
      expect(r.start).toBe(o.start) // 정수 ticks → 무손실
      expect(r.duration).toBe(o.duration) // 정수 ticks → 무손실
      expect(r.velocity).toBe(o.velocity) // round(v/127*127)=v → 무손실
    }
  })

  it('멀티 트랙: 트랙 수·트랙별 노트 수·피치가 보존된다', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = createEmptyProject('Multi')
    p = addTrack(p, t1)
    p = addTrack(p, t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, t1.id, createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 }))
    p = addNote(p, t2.id, createNote({ pitch: 36, start: 0, duration: 960, velocity: 90 }))

    const restored = midiToProject(projectToMidi(p), 'Multi')
    expect(restored.tracks).toHaveLength(2)
    expect(restored.tracks[0]!.notes).toHaveLength(2)
    expect(restored.tracks[1]!.notes).toHaveLength(1)
    expect(restored.tracks[0]!.notes.find((n) => n.start === 0)!.pitch).toBe(60)
    expect(restored.tracks[1]!.notes[0]!.pitch).toBe(36)
  })

  it('극단 velocity(1·127)도 무손실이다', () => {
    const t = createTrack('X')
    let p = addTrack(createEmptyProject('E'), t)
    // velocity=0은 MIDI note-off로 해석되어 손실됨 → 계획서 허용에 따라 1로 변경
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 1 }))
    p = addNote(p, t.id, createNote({ pitch: 61, start: 480, duration: 480, velocity: 127 }))
    const restored = midiToProject(projectToMidi(p))
    const vels = restored.tracks[0]!.notes.map((n) => n.velocity).sort((a, b) => a - b)
    expect(vels[0]).toBe(1)
    expect(vels[1]).toBe(127)
  })
})

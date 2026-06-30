import { describe, it, expect } from 'vitest'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import {
  addTrack,
  addNote,
  updateNote,
  removeNote,
  updateTrackMixer,
  updateTrackSound,
  moveNotes,
} from '../src/operations'
import type { Sound } from '../src/schema'

describe('operations (immutable)', () => {
  it('addTrack는 새 배열을 반환하고 원본을 변경하지 않는다', () => {
    const p = createEmptyProject('S')
    const t = createTrack('Piano')
    const next = addTrack(p, t)
    expect(next.tracks).toHaveLength(1)
    expect(p.tracks).toHaveLength(0)
    expect(next).not.toBe(p)
  })

  it('addNote는 지정 트랙에만 노트를 추가한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const next = addNote(p, t.id, n)
    expect(next.tracks[0]!.notes).toHaveLength(1)
    expect(p.tracks[0]!.notes).toHaveLength(0)
  })

  it('updateNote는 매칭 노트의 필드를 병합한다', () => {
    const t = createTrack('Piano')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const p = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const next = updateNote(p, t.id, n.id, { velocity: 30 })
    expect(next.tracks[0]!.notes[0]!.velocity).toBe(30)
    expect(next.tracks[0]!.notes[0]!.pitch).toBe(60)
  })

  it('removeNote는 매칭 노트를 제거한다', () => {
    const t = createTrack('Piano')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const p = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const next = removeNote(p, t.id, n.id)
    expect(next.tracks[0]!.notes).toHaveLength(0)
  })

  it('updateTrackMixer는 믹서 값을 병합한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const next = updateTrackMixer(p, t.id, { muted: true })
    expect(next.tracks[0]!.mixer.muted).toBe(true)
    expect(next.tracks[0]!.mixer.volume).toBe(0.8)
  })
})

// ── moveNotes ──────────────────────────────────────────────────

describe('moveNotes', () => {
  // 헬퍼: 트랙 + 노트를 가진 project 생성
  function makeProject() {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    const nA = createNote({ pitch: 60, start: 240, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    const nC = createNote({ pitch: 64, start: 0, duration: 120, velocity: 90 })
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    p = addNote(p, t1.id, nA)
    p = addNote(p, t1.id, nB)
    p = addNote(p, t2.id, nC)
    return { p, t1, t2, nA, nB, nC }
  }

  it('빈 ids → project 완전 불변(동일 참조)', () => {
    const { p, t1 } = makeProject()
    const next = moveNotes(p, t1.id, [], 120, 1)
    // ids가 비어있으므로 어떤 노트도 변경되지 않음
    expect(next.tracks[0]!.notes[0]!.start).toBe(240)
    expect(next.tracks[0]!.notes[1]!.start).toBe(480)
  })

  it('단일 id 이동: tickDelta=120, pitchDelta=2 → 해당 노트만 변경', () => {
    const { p, t1, nA, nB } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 120, 2)
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    const moved = notes.find((n) => n.id === nA.id)!
    const untouched = notes.find((n) => n.id === nB.id)!
    expect(moved.start).toBe(240 + 120) // 360
    expect(moved.pitch).toBe(60 + 2) // 62
    expect(untouched.start).toBe(480) // 변경 없음
    expect(untouched.pitch).toBe(62)
  })

  it('복수 id 이동: nA, nB 동시 이동 → 두 노트 모두 변경', () => {
    const { p, t1, nA, nB } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id, nB.id], 240, -1)
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nA.id)!.start).toBe(480)
    expect(notes.find((n) => n.id === nA.id)!.pitch).toBe(59)
    expect(notes.find((n) => n.id === nB.id)!.start).toBe(720)
    expect(notes.find((n) => n.id === nB.id)!.pitch).toBe(61)
  })

  it('다른 트랙의 노트는 변경되지 않는다', () => {
    const { p, t1, t2, nA, nC } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 120, 0)
    const t2Notes = next.tracks.find((t) => t.id === t2.id)!.notes
    expect(t2Notes.find((n) => n.id === nC.id)!.start).toBe(0) // 변경 없음
  })

  it('불변성: 원본 project가 변경되지 않는다', () => {
    const { p, t1, nA } = makeProject()
    const origStart = p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start
    moveNotes(p, t1.id, [nA.id], 9999, 9999)
    expect(p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start).toBe(
      origStart,
    )
  })

  it('방어적 start 클램프: tickDelta가 너무 음수여도 start >= 0', () => {
    const { p, t1, nA } = makeProject() // nA.start = 240
    const next = moveNotes(p, t1.id, [nA.id], -9999, 0)
    const moved = next.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.start).toBeGreaterThanOrEqual(0)
  })

  it('방어적 pitch 클램프: pitch 0 미만 → 0, 127 초과 → 127', () => {
    const { p, t1, nA } = makeProject() // nA.pitch = 60
    const tooLow = moveNotes(p, t1.id, [nA.id], 0, -9999)
    expect(
      tooLow.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.pitch,
    ).toBe(0)
    const tooHigh = moveNotes(p, t1.id, [nA.id], 0, 9999)
    expect(
      tooHigh.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.pitch,
    ).toBe(127)
  })

  it('ids에 없는 id는 무시된다 (일부 매칭)', () => {
    const { p, t1, nA } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id, 'no-such-id'], 120, 0)
    // nA는 이동, nB는 unchanged, no-such-id는 무시
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nA.id)!.start).toBe(360)
    expect(notes.find((n) => n.id === nA.id)!.pitch).toBe(60)
  })

  it('tickDelta=0, pitchDelta=0 → 노트값 변경 없음(pitch·start 동일)', () => {
    const { p, t1, nA } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 0, 0)
    const moved = next.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.start).toBe(240)
    expect(moved.pitch).toBe(60)
  })
})

describe('updateTrackSound', () => {
  it('지정 트랙의 sound를 교체하고 다른 필드와 다른 트랙은 유지한다', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    const newSound: Sound = { kind: 'preset', presetId: 'synth-lead' }
    p = updateTrackSound(p, t1.id, newSound)
    expect(p.tracks.find((t) => t.id === t1.id)!.sound).toEqual(newSound)
    // 다른 트랙은 기본값 유지
    expect(p.tracks.find((t) => t.id === t2.id)!.sound).toEqual({
      kind: 'preset',
      presetId: 'acoustic-piano',
    })
    // 기타 필드 보존
    expect(p.tracks.find((t) => t.id === t1.id)!.notes).toHaveLength(0)
    expect(p.tracks.find((t) => t.id === t1.id)!.mixer.volume).toBe(0.8)
  })

  it('존재하지 않는 trackId는 no-op — 프로젝트를 그대로 반환한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const newSound: Sound = { kind: 'preset', presetId: 'synth-lead' }
    const result = updateTrackSound(p, 'no-such-id', newSound)
    expect(result.tracks[0]!.sound).toEqual({ kind: 'preset', presetId: 'acoustic-piano' })
  })
})

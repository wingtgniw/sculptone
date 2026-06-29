import { describe, it, expect } from 'vitest'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addTrack, addNote, updateNote, removeNote, updateTrackMixer } from '../src/operations'

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

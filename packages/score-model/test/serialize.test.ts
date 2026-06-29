import { describe, it, expect } from 'vitest'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addNote, addTrack } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'

function sample() {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject('Round'), t), t.id, n)
}

describe('serialize', () => {
  it('serialize → deserialize 는 동등한 객체를 복원한다(무손실)', () => {
    const p = sample()
    const restored = deserializeProject(serializeProject(p))
    expect(restored).toEqual(p)
  })

  it('deserialize는 스키마 위반 입력을 거부한다', () => {
    const bad = JSON.stringify({ id: 'x', metadata: {}, transport: {}, tracks: [] })
    expect(() => deserializeProject(bad)).toThrow()
  })

  it('deserialize는 잘못된 pitch 범위를 거부한다', () => {
    const p = sample()
    const obj = JSON.parse(serializeProject(p))
    obj.tracks[0].notes[0].pitch = 999
    expect(() => deserializeProject(JSON.stringify(obj))).toThrow()
  })
})

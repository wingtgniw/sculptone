import { describe, it, expect } from 'vitest'
import { ProjectSchema, TrackSchema, NoteSchema } from '../src/schema'
import { createEmptyProject, createTrack, createNote } from '../src/factory'

describe('factory', () => {
  it('createEmptyProject는 스키마에 맞는 빈 프로젝트를 만든다', () => {
    const p = createEmptyProject('My Song')
    expect(() => ProjectSchema.parse(p)).not.toThrow()
    expect(p.metadata.title).toBe('My Song')
    expect(p.transport.ppq).toBe(480)
    expect(p.transport.tempo).toBe(120)
    expect(p.tracks).toEqual([])
  })

  it('createTrack는 기본 믹서와 피아노 프리셋을 가진 트랙을 만든다', () => {
    const t = createTrack('Piano')
    expect(() => TrackSchema.parse(t)).not.toThrow()
    expect(t.name).toBe('Piano')
    expect(t.sound).toEqual({ kind: 'preset', presetId: 'acoustic-piano' })
    expect(t.mixer).toEqual({ volume: 0.8, pan: 0, muted: false, soloed: false })
    expect(t.notes).toEqual([])
  })

  it('createNote는 스키마에 맞는 노트를 만들고 고유 id를 부여한다', () => {
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const n2 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    expect(() => NoteSchema.parse(n1)).not.toThrow()
    expect(n1.id).not.toBe(n2.id)
  })
})

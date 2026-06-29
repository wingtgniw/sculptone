import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset, listPresets } from '../src/presets'

describe('presets', () => {
  it('내장 프리셋에 acoustic-piano가 있다', () => {
    expect(getPreset('acoustic-piano')).toBeDefined()
    expect(getPreset('acoustic-piano')!.label).toBe('Acoustic Piano')
  })

  it('listPresets는 모든 프리셋 id를 반환한다', () => {
    const ids = listPresets().map((p) => p.id)
    expect(ids).toContain('acoustic-piano')
    expect(ids.length).toBe(Object.keys(PRESETS).length)
  })

  it('알 수 없는 id는 undefined', () => {
    expect(getPreset('nope')).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { descriptorToToneSpec } from '../src/instrument'
import { getPreset } from '../src/presets'

describe('descriptorToToneSpec', () => {
  it('sampler 프리셋(acoustic-piano)은 sampler 스펙', () => {
    const spec = descriptorToToneSpec(getPreset('acoustic-piano')!)
    expect(spec.kind).toBe('sampler')
    expect(spec.source).toBe('salamander')
  })
  it('synth 프리셋(synth-lead)은 toneClass=Synth', () => {
    const spec = descriptorToToneSpec(getPreset('synth-lead')!)
    expect(spec.kind).toBe('synth')
    expect(spec.toneClass).toBe('Synth')
  })
  it('electric-piano는 AMSynth', () => {
    const spec = descriptorToToneSpec(getPreset('electric-piano')!)
    expect(spec.toneClass).toBe('AMSynth')
  })
})

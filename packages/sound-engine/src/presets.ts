import type { PresetDescriptor } from './types'

export const PRESETS: Record<string, PresetDescriptor> = {
  'acoustic-piano': {
    id: 'acoustic-piano',
    label: 'Acoustic Piano',
    kind: 'sampler',
    source: 'salamander',
  },
  'electric-piano': {
    id: 'electric-piano',
    label: 'Electric Piano',
    kind: 'synth',
    source: 'AMSynth',
  },
  'synth-lead': { id: 'synth-lead', label: 'Synth Lead', kind: 'synth', source: 'Synth' },
}

export function getPreset(id: string): PresetDescriptor | undefined {
  return PRESETS[id]
}

export function listPresets(): PresetDescriptor[] {
  return Object.values(PRESETS)
}

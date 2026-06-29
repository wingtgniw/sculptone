import type { Project, Track, Note } from './schema'

function uid(): string {
  return crypto.randomUUID()
}

export function createEmptyProject(title: string): Project {
  const now = new Date().toISOString()
  return {
    id: uid(),
    metadata: { title, createdAt: now, updatedAt: now },
    transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
    tracks: [],
  }
}

export function createTrack(name: string): Track {
  return {
    id: uid(),
    name,
    color: '#55565A',
    sound: { kind: 'preset', presetId: 'acoustic-piano' },
    mixer: { volume: 0.8, pan: 0, muted: false, soloed: false },
    notes: [],
  }
}

export function createNote(input: Omit<Note, 'id'>): Note {
  return { id: uid(), ...input }
}

import type { Project, Track, Note, Sound } from './schema'

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

/**
 * 기본 커스텀 패치를 생성한다. filter/effects는 없는 최소 패치(옵셔널 필드 미설정).
 * SoundSchema를 통과하는 유효한 Sound 값을 반환한다.
 */
export function createDefaultPatch(): Sound {
  return {
    kind: 'patch',
    engine: 'synth',
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
  }
}

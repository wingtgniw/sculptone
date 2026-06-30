import type { Project, Track, Note, Mixer, Sound } from './schema'

function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
  }
}

export function addTrack(p: Project, track: Track): Project {
  return { ...p, tracks: [...p.tracks, track] }
}

export function removeTrack(p: Project, trackId: string): Project {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }
}

export function addNote(p: Project, trackId: string, note: Note): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, notes: [...t.notes, note] }))
}

export function updateNote(
  p: Project,
  trackId: string,
  noteId: string,
  patch: Partial<Omit<Note, 'id'>>,
): Project {
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
  }))
}

export function removeNote(p: Project, trackId: string, noteId: string): Project {
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.filter((n) => n.id !== noteId),
  }))
}

export function updateTrackMixer(p: Project, trackId: string, patch: Partial<Mixer>): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, mixer: { ...t.mixer, ...patch } }))
}

export function updateTrackSound(p: Project, trackId: string, sound: Sound): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, sound }))
}

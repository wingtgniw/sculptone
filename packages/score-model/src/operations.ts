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

/**
 * 지정 트랙에서 ids에 포함된 노트들을 이동한다 (불변).
 *
 * - start += tickDelta  (방어적 클램프: max(0, ...))
 * - pitch += pitchDelta (방어적 클램프: 0..127)
 * - ids에 없는 노트·다른 트랙은 변경하지 않는다.
 * - ids.length === 0 이면 동일 참조 early return.
 *
 * **drag preview 경로에서는 사용하지 말 것.**
 * 드래그 경로는 origNotes 스냅샷 + updateNote 루프로 절대 위치를 적용한다.
 */
export function moveNotes(
  p: Project,
  trackId: string,
  ids: string[],
  tickDelta: number,
  pitchDelta: number,
): Project {
  if (ids.length === 0) return p
  const idSet = new Set(ids)
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      idSet.has(n.id)
        ? {
            ...n,
            start: Math.max(0, n.start + tickDelta),
            pitch: Math.min(127, Math.max(0, n.pitch + pitchDelta)),
          }
        : n,
    ),
  }))
}

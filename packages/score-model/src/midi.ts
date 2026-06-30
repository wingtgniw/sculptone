import { Midi } from '@tonejs/midi'
import type { Project } from './schema'
import { createEmptyProject, createTrack, createNote } from './factory'
import { addTrack, addNote } from './operations'

/**
 * Project → MIDI bytes (Uint8Array).
 *
 * 각 Track이 MIDI 트랙 1개로 직렬화된다.
 * PPQ / tempo / timeSignature 는 header 에 기록한다.
 * velocity 변환: score-model(0–127 int) → @tonejs/midi(0–1 float) = Math.max(1, velocity) / 127.
 *   (MIDI note-on velocity 0 은 note-off 로 오인되어 노트가 소실되므로 최소 1 로 클램핑한다.)
 * key(조성)는 표준 MIDI 매핑 범위 밖이므로 직렬화하지 않는다(라운드트립에서 기본값 유지).
 */
export function projectToMidi(project: Project): Uint8Array {
  const midi = new Midi()

  // ppq is getter-only (WeakMap-backed); use fromJSON to set it.
  // Default is 480; only call fromJSON if we need a different value.
  if (project.transport.ppq !== midi.header.ppq) {
    midi.header.fromJSON({ ...midi.header.toJSON(), ppq: project.transport.ppq })
  }

  // setTempo replaces all tempo events with a single entry at ticks=0 and calls update().
  midi.header.setTempo(project.transport.tempo)

  // timeSignatures 는 mutable array — 0틱 항목을 추가해 박자를 기록한다.
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [project.transport.timeSignature[0], project.transport.timeSignature[1]],
  })
  midi.header.update()

  for (const track of project.tracks) {
    const midiTrack = midi.addTrack()
    midiTrack.name = track.name
    for (const note of track.notes) {
      midiTrack.addNote({
        midi: note.pitch,
        ticks: note.start,
        durationTicks: note.duration,
        velocity: Math.max(1, note.velocity) / 127,
      })
    }
  }

  // toArray() returns Uint8Array; wrap defensively for older versions.
  return new Uint8Array(midi.toArray())
}

/**
 * MIDI bytes → Project.
 *
 * 파일 ppq를 transport.ppq로 채택, 첫 tempo 이벤트를 transport.tempo로 사용.
 * tempo 없으면 120 BPM 기본값. 첫 timeSignature 이벤트를 transport.timeSignature로 복원(없으면 기본값).
 * velocity 변환: @tonejs/midi(0–1 float) → score-model(0–127 int, Math.round 후 클램핑).
 * key(조성)는 표준 MIDI 매핑 범위 밖이므로 복원하지 않고 기본값을 유지한다.
 * Note.id / Track.id / Project.id 는 새로 생성(UUID). 라운드트립에서 ID가 달라지는 것은 예상된 동작.
 */
export function midiToProject(bytes: Uint8Array, title = 'Imported'): Project {
  const midi = new Midi(bytes)
  const ppq = midi.header.ppq
  const tempo = midi.header.tempos[0]?.bpm ?? 120

  let project = createEmptyProject(title)
  const ts = midi.header.timeSignatures[0]?.timeSignature
  const timeSignature: [number, number] =
    ts && ts.length >= 2 ? [ts[0]!, ts[1]!] : project.transport.timeSignature
  project = {
    ...project,
    transport: { ...project.transport, ppq, tempo, timeSignature },
  }

  for (const midiTrack of midi.tracks) {
    const track = createTrack(midiTrack.name || 'Track')
    project = addTrack(project, track)
    for (const note of midiTrack.notes) {
      const velocity = Math.max(0, Math.min(127, Math.round(note.velocity * 127)))
      const n = createNote({
        pitch: note.midi,
        start: note.ticks,
        duration: Math.max(1, note.durationTicks),
        velocity,
      })
      project = addNote(project, track.id, n)
    }
  }

  return project
}

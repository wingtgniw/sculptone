import { useStore } from '../state/store'
import { updateNote } from '@sculptone/score-model'

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteName(pitch: number): string {
  return `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

export function Inspector() {
  const project = useStore((s) => s.project)
  const trackId = useStore((s) => s.selectedTrackId)
  const noteId = useStore((s) => s.selectedNoteId)
  const setProject = useStore((s) => s.setProject)
  const track = project.tracks.find((t) => t.id === trackId)
  const note = track?.notes.find((n) => n.id === noteId)

  if (!note) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        노트를 선택하세요
      </div>
    )
  }
  const row = { fontSize: 12, color: 'var(--text-mid)', lineHeight: 2.2 } as const
  const val = { float: 'right', color: 'var(--text-hi)' } as const
  return (
    <div style={{ padding: '14px 12px' }}>
      <p
        style={{
          fontSize: 11,
          color: 'var(--text-lo)',
          textTransform: 'uppercase',
          letterSpacing: '.1em',
          margin: '0 0 10px',
        }}
      >
        Inspector
      </p>
      <div style={row}>
        Velocity{' '}
        <span className="mono" style={val}>
          {note.velocity}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={127}
        value={note.velocity}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
        onChange={(e) =>
          setProject(updateNote(project, trackId, note.id, { velocity: Number(e.target.value) }))
        }
      />
      <div style={row}>
        Length{' '}
        <span className="mono" style={val}>
          {note.duration}t
        </span>
      </div>
      <div style={row}>
        Pitch{' '}
        <span className="mono" style={val}>
          {noteName(note.pitch)}
        </span>
      </div>
    </div>
  )
}

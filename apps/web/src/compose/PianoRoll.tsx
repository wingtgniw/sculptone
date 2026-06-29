import { useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent, type KeyboardEvent as RKeyboardEvent } from 'react'
import { useStore } from '../state/store'
import { addNote, removeNote, createNote } from '@sculptone/score-model'
import { tickToX, xToTick, pitchToY, yToPitch, durationToWidth, rollHeight, LANE_HEIGHT, NOTE_HEIGHT, PX_PER_BEAT } from './geometry'
import { divisionToTicks, snap } from './quantize'

export function PianoRoll() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const setProject = useStore((s) => s.setProject)
  const selectNote = useStore((s) => s.selectNote)
  const ref = useRef<HTMLDivElement>(null)
  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)

  const grid = divisionToTicks(quantizeDenom, ppq)

  const handleGridPointerDown = (e: RPointerEvent) => {
    if (e.target !== e.currentTarget) return // 노트 위 클릭은 별도 처리
    const rect = ref.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const start = Math.max(0, snap(xToTick(x, ppq), grid))
    const pitch = yToPitch(y)
    const note = createNote({ pitch, start, duration: grid || ppq, velocity: 96 })
    setProject(addNote(project, selectedTrackId, note))
    selectNote(note.id)
  }

  const handleNoteClick = (e: RMouseEvent, id: string) => {
    e.stopPropagation()
    selectNote(id)
  }

  const handleKeyDown = (e: RKeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId) {
      setProject(removeNote(project, selectedTrackId, selectedNoteId))
      selectNote(null)
    }
  }

  return (
    <div
      ref={ref}
      data-testid="pianoroll"
      tabIndex={0}
      onPointerDown={handleGridPointerDown}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative', height: rollHeight(), minWidth: '100%', outline: 'none',
        backgroundColor: 'var(--bg-inset)',
        backgroundImage:
          `repeating-linear-gradient(0deg, transparent 0 ${LANE_HEIGHT - 1}px, rgba(255,255,255,.03) ${LANE_HEIGHT - 1}px ${LANE_HEIGHT}px),` +
          `repeating-linear-gradient(90deg, transparent 0 ${PX_PER_BEAT - 1}px, rgba(255,255,255,.05) ${PX_PER_BEAT - 1}px ${PX_PER_BEAT}px)`,
      }}
    >
      {track?.notes.map((n) => (
        <div
          key={n.id}
          data-testid="note"
          onClick={(e) => handleNoteClick(e, n.id)}
          style={{
            position: 'absolute', left: tickToX(n.start, ppq), top: pitchToY(n.pitch),
            width: Math.max(4, durationToWidth(n.duration, ppq)), height: NOTE_HEIGHT,
            borderRadius: 4, cursor: 'pointer',
            background: n.id === selectedNoteId ? 'var(--accent-deep)' : 'var(--accent)',
            boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}
        />
      ))}
    </div>
  )
}

import { useStore } from '../state/store'

export function TracksPanel() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectTrack = useStore((s) => s.selectTrack)
  return (
    <div style={{ padding: '14px 12px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 10px' }}>Tracks</p>
      {project.tracks.map((t) => {
        const sel = t.id === selectedTrackId
        return (
          <button
            key={t.id}
            aria-current={sel}
            onClick={() => selectTrack(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: 8, borderRadius: 'var(--r-sm)', border: 0, cursor: 'pointer',
              fontSize: 12, marginBottom: 6, textAlign: 'left',
              background: sel ? 'var(--accent-soft)' : 'transparent',
              color: sel ? 'var(--text-hi)' : 'var(--text-mid)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: sel ? 'var(--accent)' : 'var(--dot-idle)' }} />
            {t.name}
          </button>
        )
      })}
    </div>
  )
}

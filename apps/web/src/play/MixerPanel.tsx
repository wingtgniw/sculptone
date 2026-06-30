import { useStore } from '../state/store'
import { updateTrackMixer } from '@sculptone/score-model'
import type { ChangeEvent } from 'react'

export function MixerPanel() {
  const project = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)

  return (
    <div style={{ padding: '24px 28px' }}>
      <p
        style={{
          fontSize: 11,
          color: 'var(--text-lo)',
          textTransform: 'uppercase',
          letterSpacing: '.1em',
          margin: '0 0 16px',
        }}
      >
        Mixer
      </p>

      {project.tracks.map((t) => (
        <div
          key={t.id}
          style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}
        >
          {/* 트랙 이름 */}
          <span
            style={{
              width: 80,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-mid)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.name}
          </span>

          {/* 볼륨 슬라이더 */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={t.mixer.volume}
            aria-label={`${t.name} volume`}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setProject(updateTrackMixer(project, t.id, { volume: Number(e.target.value) }))
            }
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />

          {/* 볼륨 수치 */}
          <span
            style={{
              width: 32,
              fontSize: 11,
              color: 'var(--text-lo)',
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {Math.round(t.mixer.volume * 100)}
          </span>

          {/* Mute */}
          <button
            aria-label={`${t.name} mute`}
            aria-pressed={t.mixer.muted}
            onClick={() => setProject(updateTrackMixer(project, t.id, { muted: !t.mixer.muted }))}
            style={{
              font: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 8px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              flexShrink: 0,
              background: t.mixer.muted ? 'var(--record)' : 'var(--bg-elevated)',
              color: t.mixer.muted ? '#fff' : 'var(--text-mid)',
            }}
          >
            M
          </button>

          {/* Solo */}
          <button
            aria-label={`${t.name} solo`}
            aria-pressed={t.mixer.soloed}
            onClick={() => setProject(updateTrackMixer(project, t.id, { soloed: !t.mixer.soloed }))}
            style={{
              font: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 8px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              flexShrink: 0,
              background: t.mixer.soloed ? 'var(--accent)' : 'var(--bg-elevated)',
              color: t.mixer.soloed ? 'var(--on-accent)' : 'var(--text-mid)',
            }}
          >
            S
          </button>
        </div>
      ))}
    </div>
  )
}

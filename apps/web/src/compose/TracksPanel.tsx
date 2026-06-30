import { useStore } from '../state/store'
import { addTrack, removeTrack, createTrack, updateTrackSound } from '@sculptone/score-model'
import { listPresets } from '@sculptone/sound-engine'
import type { ChangeEvent } from 'react'

const PRESETS = listPresets()

export function TracksPanel() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const soundPanelTrackId = useStore((s) => s.soundPanelTrackId)
  const setProject = useStore((s) => s.setProject)
  const selectTrack = useStore((s) => s.selectTrack)
  const setSoundPanelTrackId = useStore((s) => s.setSoundPanelTrackId)

  const handleAddTrack = () => {
    // 기존 "Track N" 이름 중 최대 N+1을 사용해 삭제 후 재추가 시 중복 방지
    const maxN = project.tracks.reduce((m, t) => {
      const mm = /^Track (\d+)$/.exec(t.name)
      return mm ? Math.max(m, Number(mm[1])) : m
    }, 1)
    const newTrack = createTrack(`Track ${maxN + 1}`)
    setProject(addTrack(project, newTrack))
    selectTrack(newTrack.id)
  }

  const handleDeleteTrack = (trackId: string) => {
    if (project.tracks.length <= 1) return
    const updated = removeTrack(project, trackId)
    setProject(updated)
    if (selectedTrackId === trackId) {
      selectTrack(updated.tracks[0]!.id)
    }
    if (soundPanelTrackId === trackId) {
      setSoundPanelTrackId(null)
    }
  }

  const handlePresetChange = (trackId: string, e: ChangeEvent<HTMLSelectElement>) => {
    setProject(updateTrackSound(project, trackId, { kind: 'preset', presetId: e.target.value }))
  }

  const canDelete = project.tracks.length > 1

  return (
    <div style={{ padding: '14px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-lo)',
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            margin: 0,
            flex: 1,
          }}
        >
          Tracks
        </p>
        <button
          aria-label="Add Track"
          onClick={handleAddTrack}
          style={{
            font: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
          }}
        >
          +
        </button>
      </div>

      {project.tracks.map((t) => {
        const sel = t.id === selectedTrackId
        return (
          <div key={t.id} style={{ marginBottom: 8 }}>
            {/* 트랙 선택 행 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                aria-current={sel}
                onClick={() => selectTrack(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 'var(--r-sm)',
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                  background: sel ? 'var(--accent-soft)' : 'transparent',
                  color: sel ? 'var(--text-hi)' : 'var(--text-mid)',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: sel ? 'var(--accent)' : 'var(--dot-idle)',
                    flexShrink: 0,
                  }}
                />
                {t.name}
              </button>
              {sel && (
                <>
                  <button
                    aria-label="Edit sound"
                    onClick={() => setSoundPanelTrackId(t.id)}
                    style={{
                      font: 'inherit',
                      fontSize: 10,
                      padding: '3px 6px',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                    }}
                  >
                    ♪
                  </button>
                  <button
                    aria-label="Delete Track"
                    disabled={!canDelete}
                    onClick={() => handleDeleteTrack(t.id)}
                    style={{
                      font: 'inherit',
                      fontSize: 10,
                      padding: '3px 6px',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--border)',
                      cursor: canDelete ? 'pointer' : 'not-allowed',
                      background: 'transparent',
                      color: canDelete ? 'var(--text-lo)' : 'var(--text-disabled)',
                      opacity: canDelete ? 1 : 0.4,
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>

            {/* 프리셋 드롭다운 (선택된 preset 트랙에만 표시) */}
            {sel && t.sound.kind === 'preset' && (
              <select
                aria-label="Preset"
                value={t.sound.presetId}
                onChange={(e) => handlePresetChange(t.id, e)}
                style={{
                  width: '100%',
                  marginTop: 4,
                  font: 'inherit',
                  fontSize: 11,
                  padding: '3px 6px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-mid)',
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}

            {/* 커스텀 패치 배지 (선택된 patch 트랙에만 표시) */}
            {sel && t.sound.kind === 'patch' && (
              <span
                aria-label="Custom Patch"
                style={{
                  display: 'inline-block',
                  marginTop: 4,
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                Custom Patch
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

import * as Tone from 'tone'
import { useStore } from '../state/store'
import { updateTrackSound, createDefaultPatch } from '@sculptone/score-model'
import { listPresets, createInstrumentFromSound } from '@sculptone/sound-engine'
import type { Sound } from '@sculptone/score-model'
import type { CSSProperties, ChangeEvent } from 'react'
import { PatchLibrary } from './PatchLibrary'

const PRESETS = listPresets()

// ── 스타일 상수 ────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  fontSize: 11, color: 'var(--text-lo)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em',
}
const selectStyle: CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 11, padding: '4px 6px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-mid)', cursor: 'pointer',
}
const sliderRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
}

// ── 컴포넌트 ──────────────────────────────────────────────────

export function SoundDesignPanel() {
  const project              = useStore((s) => s.project)
  const setProject           = useStore((s) => s.setProject)
  const soundPanelTrackId    = useStore((s) => s.soundPanelTrackId)
  const setSoundPanelTrackId = useStore((s) => s.setSoundPanelTrackId)

  if (!soundPanelTrackId) return null
  const track = project.tracks.find((t) => t.id === soundPanelTrackId)
  if (!track) return null

  const sound = track.sound

  // ── 헬퍼 ──────────────────────────────────────────────────

  const commit = (next: Sound) =>
    setProject(updateTrackSound(project, soundPanelTrackId, next))

  const updatePatch = (updates: Partial<Extract<Sound, { kind: 'patch' }>>) => {
    if (sound.kind !== 'patch') return
    commit({ ...sound, ...updates })
  }

  const handlePreview = async () => {
    await Tone.start()
    const inst = createInstrumentFromSound(sound)
    let tail: number
    if (sound.kind === 'patch') {
      const reverb = (sound.effects ?? []).find(
        (fx): fx is Extract<typeof fx, { type: 'reverb' }> => fx.type === 'reverb'
      )
      tail = 0.5 + (sound.envelope.release ?? 0.5) + (reverb?.decay ?? 0)
    } else {
      tail = 1.5
    }
    try {
      inst.triggerAttackRelease('C4', 0.5)
    } finally {
      setTimeout(() => inst.dispose(), (tail + 0.3) * 1000)
    }
  }

  // ── 렌더 ───────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-label="Sound Design"
      style={{
        position: 'fixed', top: 0, right: 0, width: 300, height: '100vh',
        background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
        overflowY: 'auto', padding: '20px 18px', zIndex: 100,
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '-4px 0 16px rgba(0,0,0,.18)',
      }}
    >
      {/* ── 헤더 ── */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-hi)', margin: 0 }}>
          {track.name} — Sound
        </h2>
        <button
          aria-label="Close sound panel"
          onClick={() => setSoundPanelTrackId(null)}
          style={{ font: 'inherit', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-lo)', lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* ── Preset 모드 ── */}
      {sound.kind === 'preset' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Preset</label>
          <select
            aria-label="Sound preset"
            value={sound.presetId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              commit({ kind: 'preset', presetId: e.target.value })
            }
            style={selectStyle}
          >
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button
            aria-label="Switch to custom patch"
            onClick={() => commit(createDefaultPatch())}
            style={{
              font: 'inherit', fontSize: 11, padding: '5px 10px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: 'var(--accent-soft)', color: 'var(--accent)',
            }}
          >
            Switch to Patch
          </button>
        </section>
      )}

      {/* ── Patch 모드 ── */}
      {sound.kind === 'patch' && (
        <>
          {/* Engine */}
          <section>
            <label style={labelStyle}>Engine</label>
            <select
              aria-label="Synth engine"
              value={sound.engine}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                updatePatch({ engine: e.target.value as 'synth' | 'fm' | 'am' })
              }
              style={selectStyle}
            >
              <option value="synth">Synth</option>
              <option value="fm">FM Synth</option>
              <option value="am">AM Synth</option>
            </select>
          </section>

          {/* Oscillator */}
          <section>
            <p style={{ ...labelStyle, margin: '0 0 10px' }}>Oscillator</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={labelStyle}>Waveform</label>
                <select
                  aria-label="Oscillator type"
                  value={sound.oscillator?.type ?? 'sine'}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    updatePatch({
                      oscillator: {
                        type: e.target.value as 'sine' | 'square' | 'sawtooth' | 'triangle',
                        detune: sound.oscillator?.detune ?? 0,
                      },
                    })
                  }
                  style={selectStyle}
                >
                  <option value="sine">Sine</option>
                  <option value="square">Square</option>
                  <option value="sawtooth">Sawtooth</option>
                  <option value="triangle">Triangle</option>
                </select>
              </div>
              <div style={sliderRowStyle}>
                <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
                  Detune
                </label>
                <input
                  type="range"
                  aria-label="Oscillator detune"
                  min={-1200}
                  max={1200}
                  step={1}
                  value={sound.oscillator?.detune ?? 0}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updatePatch({
                      oscillator: {
                        type: sound.oscillator?.type ?? 'sine',
                        detune: Number(e.target.value),
                      },
                    })
                  }
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                  {(sound.oscillator?.detune ?? 0) > 0
                    ? `+${sound.oscillator?.detune ?? 0}¢`
                    : `${sound.oscillator?.detune ?? 0}¢`}
                </span>
              </div>
            </div>
          </section>

          {/* ADSR */}
          <section>
            <p style={{ ...labelStyle, margin: '0 0 10px' }}>Envelope</p>
            {(['attack', 'decay', 'sustain', 'release'] as const).map((param) => (
              <div key={param} style={sliderRowStyle}>
                <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0, textTransform: 'capitalize' }}>
                  {param}
                </label>
                <input
                  type="range"
                  aria-label={`Envelope ${param}`}
                  min={0}
                  max={param === 'sustain' ? 1 : 2}
                  step={0.001}
                  value={sound.envelope[param]}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updatePatch({ envelope: { ...sound.envelope, [param]: Number(e.target.value) } })
                  }
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                  {param === 'sustain'
                    ? sound.envelope[param].toFixed(2)
                    : `${Math.round(sound.envelope[param] * 1000)}ms`}
                </span>
              </div>
            ))}
          </section>

          {/* Filter */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ ...labelStyle, margin: 0, flex: 1 }}>Filter</p>
              <input
                type="checkbox"
                aria-label="Enable filter"
                checked={!!sound.filter}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updatePatch({ filter: e.target.checked ? { type: 'lowpass', frequency: 2000, Q: 1 } : undefined })
                }
              />
            </div>
            {sound.filter && (() => {
              const f = sound.filter
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select
                    aria-label="Filter type"
                    value={f.type}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      updatePatch({ filter: { ...f, type: e.target.value as 'lowpass' | 'highpass' | 'bandpass' } })
                    }
                    style={selectStyle}
                  >
                    <option value="lowpass">Low Pass</option>
                    <option value="highpass">High Pass</option>
                    <option value="bandpass">Band Pass</option>
                  </select>
                  {(['frequency', 'Q'] as const).map((fp) => (
                    <div key={fp} style={sliderRowStyle}>
                      <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
                        {fp === 'frequency' ? 'Cutoff' : 'Q'}
                      </label>
                      <input
                        type="range"
                        aria-label={`Filter ${fp}`}
                        min={fp === 'frequency' ? 20 : 0}
                        max={fp === 'frequency' ? 20000 : 20}
                        step={fp === 'frequency' ? 1 : 0.1}
                        value={f[fp]}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          updatePatch({ filter: { ...f, [fp]: Number(e.target.value) } })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                        {fp === 'frequency' ? `${f.frequency}Hz` : f.Q.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </section>

          {/* LFO */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ ...labelStyle, margin: 0, flex: 1 }}>LFO</p>
              <input
                type="checkbox"
                aria-label="LFO enable"
                checked={!!sound.lfo}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updatePatch({
                    lfo: e.target.checked
                      ? { target: 'amplitude', rate: 1, depth: 0.5 }
                      : undefined,
                  })
                }
              />
            </div>
            {sound.lfo && (() => {
              const lfo = sound.lfo
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select
                    aria-label="LFO target"
                    value={lfo.target}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      updatePatch({ lfo: { ...lfo, target: e.target.value as 'filter' | 'pitch' | 'amplitude' } })
                    }
                    style={selectStyle}
                  >
                    <option value="filter">Filter Cutoff</option>
                    <option value="pitch">Pitch (Vibrato)</option>
                    <option value="amplitude">Amplitude (Tremolo)</option>
                  </select>

                  {/* Rate */}
                  <div style={sliderRowStyle}>
                    <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
                      Rate
                    </label>
                    <input
                      type="range"
                      aria-label="LFO rate"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={lfo.rate}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updatePatch({ lfo: { ...lfo, rate: Math.max(0.1, Number(e.target.value)) } })
                      }
                      style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                      {lfo.rate.toFixed(1)}Hz
                    </span>
                  </div>

                  {/* Depth */}
                  <div style={sliderRowStyle}>
                    <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
                      Depth
                    </label>
                    <input
                      type="range"
                      aria-label="LFO depth"
                      min={0}
                      max={1}
                      step={0.01}
                      value={lfo.depth}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updatePatch({ lfo: { ...lfo, depth: Number(e.target.value) } })
                      }
                      style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                      {Math.round(lfo.depth * 100)}%
                    </span>
                  </div>
                </div>
              )
            })()}
          </section>

          {/* Reverb */}
          <section>
            {(() => {
              const reverb = (sound.effects ?? []).find((fx): fx is Extract<typeof fx, { type: 'reverb' }> => fx.type === 'reverb')
              const toggleReverb = (e: ChangeEvent<HTMLInputElement>) => {
                updatePatch({
                  effects: e.target.checked
                    ? [...(sound.effects ?? []), { type: 'reverb' as const, wet: 0.3, decay: 2 }]
                    : (sound.effects ?? []).filter((fx) => fx.type !== 'reverb'),
                })
              }
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                    <p style={{ ...labelStyle, margin: 0, flex: 1 }}>Reverb</p>
                    <input type="checkbox" aria-label="Enable reverb" checked={!!reverb} onChange={toggleReverb} />
                  </div>
                  {reverb && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(['wet', 'decay'] as const).map((rp) => (
                        <div key={rp} style={sliderRowStyle}>
                          <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0, textTransform: 'capitalize' }}>
                            {rp}
                          </label>
                          <input
                            type="range"
                            aria-label={`Reverb ${rp}`}
                            min={rp === 'wet' ? 0 : 0.1}
                            max={rp === 'wet' ? 1 : 10}
                            step={rp === 'wet' ? 0.01 : 0.1}
                            value={reverb[rp]}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updatePatch({
                                effects: (sound.effects ?? []).map((fx) =>
                                  fx.type === 'reverb' ? { ...fx, [rp]: Number(e.target.value) } : fx
                                ),
                              })
                            }
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                          />
                          <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                            {rp === 'wet' ? reverb.wet.toFixed(2) : `${reverb.decay.toFixed(1)}s`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </section>

          {/* 프리셋으로 돌아가기 */}
          <button
            aria-label="Use preset instead"
            onClick={() => commit({ kind: 'preset', presetId: 'acoustic-piano' })}
            style={{
              font: 'inherit', fontSize: 11, padding: '5px 10px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: 'transparent', color: 'var(--text-lo)',
            }}
          >
            Use Preset Instead
          </button>

          {/* Patch Library — 저장/불러오기/삭제 */}
          <PatchLibrary trackId={soundPanelTrackId} currentSound={sound} />
        </>
      )}

      {/* 프리뷰 */}
      <button
        aria-label="Preview sound"
        onClick={handlePreview}
        style={{
          font: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 12px',
          borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: 'var(--on-accent)',
          marginTop: 'auto',
        }}
      >
        Preview ▶
      </button>
    </div>
  )
}

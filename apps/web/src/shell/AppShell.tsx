import { type CSSProperties } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'
import { FileMenu } from '../ui/FileMenu'
import { PianoRoll } from '../compose/PianoRoll'
import { TracksPanel } from '../compose/TracksPanel'
import { Inspector } from '../compose/Inspector'
import { Playhead } from '../compose/Playhead'
import { TransportBar } from '../audio/TransportBar'
import { useAudio } from '../audio/useAudio'
import { useAutosave } from '../io/useAutosave'
import { MixerPanel } from '../play/MixerPanel'
import { useMidi } from '../midi/useMidi'
import { useRecording } from '../midi/useRecording'
import { MidiDeviceSelect } from '../midi/MidiDeviceSelect'
import { NotationView } from '../notation/NotationView'

const TABS = [
  { id: 'compose',    label: 'Compose' },
  { id: 'play',       label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

export function AppShell() {
  useAutosave()

  const activeMode     = useStore((s) => s.activeMode)
  const setMode        = useStore((s) => s.setMode)
  const composeView    = useStore((s) => s.composeView)
  const setComposeView = useStore((s) => s.setComposeView)
  const tempo          = useStore((s) => s.project.transport.tempo)
  const timeSignature  = useStore((s) => s.project.transport.timeSignature)
  const { play, stop, getSeconds } = useAudio()

  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
        {activeMode === 'compose' && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              aria-pressed={composeView === 'roll'}
              onClick={() => setComposeView('roll')}
              style={{
                font: 'inherit', fontSize: 11, fontWeight: 600,
                padding: '3px 10px', borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
                border: '1px solid var(--border)', cursor: 'pointer',
                background: composeView === 'roll' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'roll' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Roll
            </button>
            <button
              aria-pressed={composeView === 'score'}
              onClick={() => setComposeView('score')}
              style={{
                font: 'inherit', fontSize: 11, fontWeight: 600,
                padding: '3px 10px', borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                border: '1px solid var(--border)', cursor: 'pointer',
                background: composeView === 'score' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'score' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Score
            </button>
          </div>
        )}
        <FileMenu />
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {tempo} BPM · {timeSignature.join('/')}
        </span>
      </div>

      {/* 본문 */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region, overflowY: 'auto' }}>
          {activeMode === 'compose' && <TracksPanel />}
        </div>
        <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
          {activeMode === 'compose' && composeView === 'roll' && (
            <div style={{ position: 'relative' }}>
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
            </div>
          )}
          {activeMode === 'compose' && composeView === 'score' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <NotationView />
            </div>
          )}
          {activeMode === 'play' && (
            <div style={{ overflowY: 'auto', height: '100%' }}>
              <MixerPanel />
            </div>
          )}
        </div>
        <div style={{ ...region, overflowY: 'auto' }}>
          {activeMode === 'compose' && <Inspector />}
        </div>
      </div>

      {/* 트랜스포트 */}
      <div style={region}>
        <TransportBar onPlay={play} onStop={stop} />
      </div>
    </div>
  )
}

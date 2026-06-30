import { type CSSProperties, useEffect } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'
import { FileMenu } from '../ui/FileMenu'
import { PianoRoll } from '../compose/PianoRoll'
import { LoopStrip } from '../compose/LoopStrip'
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
import { SoundDesignPanel } from '../sound/SoundDesignPanel'
import { ShortcutsHelp } from './ShortcutsHelp'
import { matchShortcut } from './shortcuts'
import { useClipboard } from '../compose/useClipboard'

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

const undoBtnBase: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  lineHeight: 1.4,
}
const undoBtnDisabled: CSSProperties = {
  ...undoBtnBase,
  opacity: 0.35,
  cursor: 'not-allowed',
}

const helpBtnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  width: 24,
  height: 24,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  lineHeight: 1,
}

export function AppShell() {
  useAutosave()

  const activeMode = useStore((s) => s.activeMode)
  const setMode = useStore((s) => s.setMode)
  const composeView = useStore((s) => s.composeView)
  const setComposeView = useStore((s) => s.setComposeView)
  const tempo = useStore((s) => s.project.transport.tempo)
  const timeSignature = useStore((s) => s.project.transport.timeSignature)
  const { play, stop, getSeconds } = useAudio()
  useClipboard({ getSeconds })

  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.history.past.length > 0)
  const canRedo = useStore((s) => s.history.future.length > 0)

  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modLabel = isMac ? 'Cmd' : 'Ctrl'

  // 전역 키보드 단축키:
  //   Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y = redo (기존 보존)
  //   Space = 재생/정지, R = 녹음 토글, M = 메트로놈 토글, ? = 도움말 토글
  // 입력 필드(INPUT/TEXTAREA/SELECT/contentEditable) 포커스 시 무시.
  // Ctrl/Cmd/Alt 있는 조합은 matchShortcut이 null을 반환해 단일 키 단축키는 발동 안 함.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputLike =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable

      // ── Undo/Redo: Ctrl/Cmd 조합 (입력 필드에서도 무시) ──
      if (!isInputLike) {
        const mod = isMac ? e.metaKey : e.ctrlKey
        const k = e.key.toLowerCase()
        if (mod && !e.shiftKey && k === 'z') {
          e.preventDefault()
          undo()
        }
        if (mod && e.shiftKey && k === 'z') {
          e.preventDefault()
          redo()
        }
        if (!isMac && e.ctrlKey && !e.shiftKey && k === 'y') {
          e.preventDefault()
          redo()
        }
      }

      // ── 단일 키 단축키: matchShortcut이 가드와 매칭을 통합 처리 ──
      const action = matchShortcut(e)
      if (!action) return
      if (e.repeat) return // 키 홀드 오토리피트 시 토글 폭주 방지

      const {
        isPlaying,
        isRecording,
        setRecording,
        metronomeEnabled,
        setMetronomeEnabled,
        toggleShortcuts,
      } = useStore.getState()

      if (action === 'play') {
        e.preventDefault() // 페이지 스크롤 방지
        if (isPlaying) {
          stop()
        } else {
          play()
        }
      } else if (action === 'record') {
        setRecording(!isRecording)
      } else if (action === 'metronome') {
        setMetronomeEnabled(!metronomeEnabled)
      } else if (action === 'help') {
        toggleShortcuts()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, isMac, play, stop])

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />

        {/* Undo / Redo 버튼 */}
        <button
          aria-label="실행 취소"
          disabled={!canUndo}
          onClick={undo}
          title={`Undo (${modLabel}+Z)`}
          style={canUndo ? undoBtnBase : undoBtnDisabled}
        >
          ↩
        </button>
        <button
          aria-label="다시 실행"
          disabled={!canRedo}
          onClick={redo}
          title={`Redo (${modLabel}+Shift+Z)`}
          style={canRedo ? undoBtnBase : undoBtnDisabled}
        >
          ↪
        </button>

        {activeMode === 'compose' && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              aria-pressed={composeView === 'roll'}
              onClick={() => setComposeView('roll')}
              style={{
                font: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
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
                font: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                border: '1px solid var(--border)',
                cursor: 'pointer',
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

        {/* 단축키 도움말 버튼 (?) */}
        <button
          aria-label="단축키 도움말"
          onClick={() => useStore.getState().toggleShortcuts()}
          title="키보드 단축키 (Shift+/)"
          style={helpBtnStyle}
        >
          ?
        </button>

        <span
          className="mono"
          style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}
        >
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
              <LoopStrip />
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

      {/* 사운드 디자인 패널 (전역 오버레이 — soundPanelTrackId !== null 일 때 표시) */}
      <SoundDesignPanel />

      {/* 단축키 도움말 오버레이 */}
      <ShortcutsHelp />
    </div>
  )
}

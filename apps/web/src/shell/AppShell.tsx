import type { CSSProperties } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]

const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

export function AppShell() {
  const activeMode = useStore((s) => s.activeMode)
  const setMode = useStore((s) => s.setMode)
  const project = useStore((s) => s.project)

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {project.transport.tempo} BPM · {project.transport.timeSignature.join('/')}
        </span>
      </div>

      {/* 본문: 좌 패널 · 중앙 캔버스 · 우 인스펙터 */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region }} aria-label="source-panel" />
        <div style={{ background: 'var(--bg-inset)', display: 'grid', placeItems: 'center', color: 'var(--text-lo)' }}>
          {activeMode === 'compose' && 'Compose 캔버스 (P1 슬라이스 3에서 구현)'}
          {activeMode === 'play' && 'Play 믹서 (P1 슬라이스 6에서 구현)'}
        </div>
        <div style={{ ...region }} aria-label="inspector" />
      </div>

      {/* 트랜스포트 */}
      <div style={{ ...region, display: 'grid', placeItems: 'center', color: 'var(--text-lo)' }}>
        Transport (P1 슬라이스 4에서 구현)
      </div>
    </div>
  )
}

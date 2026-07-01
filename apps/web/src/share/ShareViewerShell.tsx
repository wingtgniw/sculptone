import { useEffect, type CSSProperties, type KeyboardEvent } from 'react'
import { useShareStore } from '../cloud/shareStore'
import { useStore } from '../state/store'
import { PianoRoll } from '../compose/PianoRoll'
import { VelocityLane } from '../compose/VelocityLane'
import { Playhead } from '../compose/Playhead'
import { TransportBar } from '../audio/TransportBar'
import { useAudio } from '../audio/useAudio'

const region: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
}

/**
 * 읽기전용 공유 뷰어 셸.
 *
 * read-only 차단:
 * 1. pointer-events:none 래퍼 → 드래그/클릭 편집 차단
 * 2. onKeyDownCapture → PianoRoll의 React synthetic onKeyDown(Delete 등)이
 *    버블링 단계에 도달하기 전에 캡처 단계에서 stopPropagation으로 차단.
 * 3. useAutosave / useCloudSync / useRecording 미마운트 → 저장·동기화·녹음 없음
 * 4. AppShell의 전역 keydown 리스너(window.addEventListener) 미마운트 → 편집 단축키 없음
 */
export function ShareViewerShell() {
  const sharedProject = useShareStore((s) => s.sharedProject)
  const replaceProject = useStore((s) => s.replaceProject)
  const { play, stop, getSeconds } = useAudio()

  // 공유 프로젝트를 store에 1회 로드 (히스토리 리셋 포함)
  useEffect(() => {
    if (sharedProject) {
      replaceProject(sharedProject)
    }
    // sharedProject 참조는 마운트 시 고정 — 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 캡처 단계에서 키보드 이벤트 전파 차단
  // PianoRoll이 React synthetic onKeyDown(버블링)을 사용하므로
  // 캡처 단계 stopPropagation으로 하위 핸들러 도달 전 차단
  const blockKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 — 읽기전용 배지 + 프로젝트 제목 */}
      <div
        style={{
          ...region,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 14px',
        }}
      >
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
          }}
        >
          읽기전용
        </span>
        {sharedProject && (
          <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>
            {sharedProject.metadata.title}
          </span>
        )}
        <a
          href={window.location.origin}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--text-mid)',
            textDecoration: 'none',
          }}
        >
          편집 앱으로 돌아가기
        </a>
      </div>

      {/* 본문 — PianoRoll + VelocityLane
          pointer-events:none → 드래그/클릭 편집 차단
          onKeyDownCapture → Delete 등 키보드 편집 차단 */}
      <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
        <div
          onKeyDownCapture={blockKeyDown}
          style={{
            position: 'relative',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <PianoRoll />
          <VelocityLane />
          <Playhead getSeconds={getSeconds} />
        </div>
      </div>

      {/* 트랜스포트 — 재생/정지만 (showRecord=false: 녹음 버튼·REC 배지 제외, pointer-events 허용) */}
      <div style={region}>
        <TransportBar onPlay={play} onStop={stop} showRecord={false} />
      </div>
    </div>
  )
}

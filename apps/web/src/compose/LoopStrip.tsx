import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import { tickToX, xToTick, PX_PER_BEAT } from './geometry'
import { divisionToTicks, snap } from './quantize'
import {
  computeLoopDrawRegion,
  computeLoopMove,
  computeLoopResizeStart,
  computeLoopResizeEnd,
} from './loop'

const STRIP_HEIGHT = 16
const HANDLE_WIDTH = 6
/** #fix4: 클릭과 드래그를 구별하는 픽셀 임계값 */
const DRAG_THRESHOLD = 4

/** LoopStrip 드래그 상태 */
interface LoopDragState {
  /** 드래그 유형 */
  type: 'draw' | 'move' | 'resizeStart' | 'resizeEnd'
  /** pointerdown 시점의 clientX */
  startX: number
  /** 드래그 시작 시의 loopStartTicks 스냅샷 */
  origStartTicks: number
  /** 드래그 시작 시의 loopEndTicks 스냅샷 */
  origEndTicks: number
  /** #fix4: DRAG_THRESHOLD를 초과해 실제 드래그가 발생했는지 여부 */
  moved: boolean
}

export function LoopStrip() {
  const ppq = useStore((s) => s.project.transport.ppq)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const loopEnabled = useStore((s) => s.loopEnabled)
  const loopStartTicks = useStore((s) => s.loopStartTicks)
  const loopEndTicks = useStore((s) => s.loopEndTicks)
  const setLoopRegion = useStore((s) => s.setLoopRegion)
  const setLoopEnabled = useStore((s) => s.setLoopEnabled)
  const isPlaying = useStore((s) => s.isPlaying) // #fix6

  const stripRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<LoopDragState | null>(null)

  const grid = divisionToTicks(quantizeDenom, ppq)
  /** #fix3: 최소 루프 폭 — 최소 1그리드 (그리드 없으면 ppq = 1박) */
  const minLoop = grid > 0 ? grid : ppq

  const loopStartX = tickToX(loopStartTicks, ppq)
  const loopEndX = tickToX(loopEndTicks, ppq)
  const regionWidth = Math.max(0, loopEndX - loopStartX)

  // ── 빈 영역 pointerdown: 새 구간 그리기 시작 ────────────────

  const handleStripPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // 자식 요소(region/handle)에서 올라온 이벤트는 stopPropagation으로 차단됨.
    if (e.target !== e.currentTarget) return
    // #fix6: 재생 중에는 드래그 무시
    if (isPlaying) return

    const rect = stripRef.current?.getBoundingClientRect() ?? { left: 0 }
    const rawTick = xToTick(e.clientX - rect.left, ppq)
    // #fix5: startTick을 그리드에 스냅
    const startTick = grid > 0 ? snap(rawTick, grid) : rawTick
    dragRef.current = {
      type: 'draw',
      startX: e.clientX,
      origStartTicks: startTick,
      origEndTicks: startTick,
      moved: false, // #fix4: 임계 미달이면 false
    }
    // #fix4: pointerdown에서 즉시 setLoopRegion 호출 제거 — pointermove에서 임계 초과 시에만 설정
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 구간 본체 pointerdown: 이동 ──────────────────────────────

  const handleRegionPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'move',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 시작점 핸들 pointerdown ───────────────────────────────────

  const handleResizeStartPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'resizeStart',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 종료점 핸들 pointerdown ───────────────────────────────────

  const handleResizeEndPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'resizeEnd',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 드래그 진행: strip pointermove ───────────────────────────

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const { type, startX, origStartTicks, origEndTicks } = dragRef.current

    const rect = stripRef.current?.getBoundingClientRect() ?? { left: 0 }
    const dx = e.clientX - startX

    // #fix4: DRAG_THRESHOLD 미달 시 무시 — 순수 클릭과 드래그 구별
    if (!dragRef.current.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    dragRef.current.moved = true

    // 픽셀→틱 변환: pxPerTick = PX_PER_BEAT / ppq
    const deltaTicks = dx / (PX_PER_BEAT / ppq)

    let region: { loopStart: number; loopEnd: number }

    if (type === 'draw') {
      const drawStartTick = xToTick(startX - rect.left, ppq)
      const currentTick = xToTick(e.clientX - rect.left, ppq)
      // #fix3: minLoop(최소 1그리드) 전달
      region = computeLoopDrawRegion(drawStartTick, currentTick, grid, minLoop)
    } else if (type === 'move') {
      region = computeLoopMove(origStartTicks, origEndTicks, deltaTicks, grid)
    } else if (type === 'resizeStart') {
      // #fix3: minLoop 전달
      region = computeLoopResizeStart(origStartTicks, origEndTicks, deltaTicks, grid, minLoop)
    } else {
      // #fix3: minLoop 전달
      region = computeLoopResizeEnd(origStartTicks, origEndTicks, deltaTicks, grid, minLoop)
    }

    setLoopRegion(region.loopStart, region.loopEnd)
  }

  // ── 드래그 종료: strip pointerup ─────────────────────────────

  const handlePointerUp = (_e: RPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      // #fix4: 실제 드래그(임계 초과)가 있었을 때만 loopEnabled 자동 활성화
      if (dragRef.current.moved && !loopEnabled) {
        setLoopEnabled(true)
      }
    }
    dragRef.current = null
  }

  return (
    <div
      ref={stripRef}
      data-testid="loop-strip"
      onPointerDown={handleStripPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'relative',
        height: STRIP_HEIGHT,
        minWidth: '100%',
        background: 'var(--bg-elevated)',
        // #fix6: 재생 중에는 커서와 opacity로 비활성 상태 표시
        cursor: isPlaying ? 'default' : 'crosshair',
        userSelect: 'none',
        opacity: isPlaying ? 0.5 : loopEnabled ? 1 : 0.4,
      }}
    >
      {/* 루프 구간 표시 영역 */}
      <div
        data-testid="loop-region"
        onPointerDown={handleRegionPointerDown}
        style={{
          position: 'absolute',
          left: loopStartX,
          top: 0,
          width: regionWidth,
          height: STRIP_HEIGHT,
          // Copper 반투명 (디자인 토큰 미지정 시 인라인 폴백)
          background: 'rgba(184, 115, 51, 0.45)',
          cursor: 'grab',
        }}
      >
        {/* 시작점 리사이즈 핸들 (좌측) */}
        <div
          data-testid="loop-resize-start"
          onPointerDown={handleResizeStartPointerDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: HANDLE_WIDTH,
            cursor: 'ew-resize',
            background: 'rgba(184, 115, 51, 0.8)',
          }}
        />
        {/* 종료점 리사이즈 핸들 (우측) */}
        <div
          data-testid="loop-resize-end"
          onPointerDown={handleResizeEndPointerDown}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: HANDLE_WIDTH,
            cursor: 'ew-resize',
            background: 'rgba(184, 115, 51, 0.8)',
          }}
        />
      </div>
    </div>
  )
}

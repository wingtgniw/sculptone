import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { LoopStrip } from '../LoopStrip'

/**
 * jsdom 제약 메모:
 * - getBoundingClientRect() 는 항상 { left:0, top:0, ... } 반환.
 *   따라서 clientX 자체가 절대 x 좌표처럼 동작한다.
 * - jsdom 25에서 PointerEvent 생성자가 clientX를 지원하지 않는 문제
 *   (read-only 속성)로 인해, Object.defineProperty로 직접 설정하는
 *   firePointerEvent 헬퍼를 사용한다. (PianoRoll.drag.test.tsx와 동일 패턴)
 * - setPointerCapture 미구현 → try/catch 무시.
 *
 * 좌표 해설 (PPQ=480, PX_PER_BEAT=48, quantizeDenom=16 → grid=120):
 *   xToTick(x, 480) = x * (480/48) = x * 10
 *   1px = 10 ticks, 48px = 480 ticks (1박)
 *
 * pointerdown → pointermove → pointerup 시퀀스로 드래그 시뮬레이션.
 */

/** jsdom 25 우회: PointerEvent 생성자가 clientX를 지원하지 않으므로 defineProperty로 주입. */
function firePointerEvent(
  el: Element,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperty(e, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(e, 'clientY', { value: clientY, configurable: true })
  Object.defineProperty(e, 'pointerId', { value: pointerId, configurable: true })
  el.dispatchEvent(e)
}

describe('LoopStrip smoke', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('data-testid="loop-strip"이 렌더된다', () => {
    render(<LoopStrip />)
    expect(screen.getByTestId('loop-strip')).toBeInTheDocument()
  })

  // #2: 절대값 단언으로 교체 — 거짓음성 방지
  it('빈 영역 드래그로 새 루프 구간이 설정된다 (loopStartTicks=480, loopEndTicks=1920)', () => {
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')

    // PX_PER_BEAT=48, PPQ=480, quantizeDenom=16, grid=120:
    // pointerdown at clientX=48 → rawTick=480 → snap(480,120)=480
    // pointermove to clientX=192 → currentTick=1920 → snap(1920,120)=1920
    // computeLoopDrawRegion(480, 1920, 120) → {loopStart:480, loopEnd:1920}
    act(() => {
      firePointerEvent(strip, 'pointerdown', 48, 8)
      firePointerEvent(strip, 'pointermove', 192, 8)
      firePointerEvent(strip, 'pointerup', 192, 8)
    })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(480)
    expect(loopEndTicks).toBe(1920)
    expect(useStore.getState().loopEnabled).toBe(true)
  })

  it('loopEnabled=false이면 strip의 opacity가 낮다 (흐리게)', () => {
    act(() => {
      useStore.getState().setLoopEnabled(false)
    })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')
    const opacity = (strip as HTMLElement).style.opacity
    // loopEnabled=false → opacity=0.4 (흐리게)
    expect(Number(opacity)).toBeLessThan(1)
  })

  it('loopEnabled=true이면 strip의 opacity가 1이다', () => {
    act(() => {
      useStore.getState().setLoopEnabled(true)
    })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')
    const opacity = (strip as HTMLElement).style.opacity
    expect(Number(opacity)).toBe(1)
  })

  // #4: DRAG_THRESHOLD — 순수 클릭은 기존 구간 보존
  it('[fix4] 빈 영역 순수 클릭(이동 없음)은 루프 구간과 loopEnabled를 변경하지 않는다', () => {
    act(() => {
      useStore.getState().setLoopRegion(240, 720)
      useStore.getState().setLoopEnabled(false)
    })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')

    act(() => {
      firePointerEvent(strip, 'pointerdown', 48, 8)
      // pointermove 없음 — 순수 클릭
      firePointerEvent(strip, 'pointerup', 48, 8)
    })

    const { loopStartTicks, loopEndTicks, loopEnabled } = useStore.getState()
    expect(loopStartTicks).toBe(240) // 불변
    expect(loopEndTicks).toBe(720) // 불변
    expect(loopEnabled).toBe(false) // 클릭만으로 활성화 안 됨
  })

  // #6: 재생 중 LoopStrip 드래그 비활성화
  it('[fix6] 재생 중(isPlaying=true)에는 빈 영역 드래그가 루프 구간을 변경하지 않는다', () => {
    act(() => {
      useStore.getState().setLoopRegion(0, 960)
      useStore.getState().setPlaying(true)
    })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')

    const origStart = useStore.getState().loopStartTicks
    const origEnd = useStore.getState().loopEndTicks

    act(() => {
      firePointerEvent(strip, 'pointerdown', 48, 8)
      firePointerEvent(strip, 'pointermove', 192, 8)
      firePointerEvent(strip, 'pointerup', 192, 8)
    })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(origStart) // 불변
    expect(loopEndTicks).toBe(origEnd) // 불변
  })

  // #7: resize 핸들 스모크 — resize-end
  it('[fix7] resize-end 핸들 드래그로 loopEndTicks가 960으로 증가하고 loopStartTicks는 불변이다', () => {
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setLoopRegion(0, 480)
    })
    render(<LoopStrip />)
    const resizeEnd = screen.getByTestId('loop-resize-end')
    const strip = screen.getByTestId('loop-strip')

    // pointerdown at clientX=200, pointermove to 248: dx=48px → deltaTicks=480
    // computeLoopResizeEnd(0, 480, 480, 120) → {loopStart:0, loopEnd:960}
    act(() => {
      firePointerEvent(resizeEnd, 'pointerdown', 200, 8)
      firePointerEvent(strip, 'pointermove', 248, 8)
      firePointerEvent(strip, 'pointerup', 248, 8)
    })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(0) // 불변
    expect(loopEndTicks).toBe(960) // 480 + 480 = 960
  })

  // #7: resize 핸들 스모크 — resize-start
  it('[fix7] resize-start 핸들 드래그로 loopStartTicks가 480으로 증가하고 loopEndTicks는 불변이다', () => {
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setLoopRegion(0, 960)
    })
    render(<LoopStrip />)
    const resizeStart = screen.getByTestId('loop-resize-start')
    const strip = screen.getByTestId('loop-strip')

    // pointerdown at clientX=10, pointermove to 58: dx=48px → deltaTicks=480
    // computeLoopResizeStart(0, 960, 480, 120) → {loopStart:480, loopEnd:960}
    act(() => {
      firePointerEvent(resizeStart, 'pointerdown', 10, 8)
      firePointerEvent(strip, 'pointermove', 58, 8)
      firePointerEvent(strip, 'pointerup', 58, 8)
    })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(480) // 오른쪽으로 480틱 이동
    expect(loopEndTicks).toBe(960) // 불변
  })

  // #9: 절대값 단언으로 교체
  it('구간 본체(loop-region) 드래그로 loopStartTicks=480, loopEndTicks=960이 된다', () => {
    // 먼저 구간 설정
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setLoopRegion(0, 480)
    })
    render(<LoopStrip />)
    const region = screen.getByTestId('loop-region')
    const strip = screen.getByTestId('loop-strip')

    // region pointerdown at 50, pointermove to 98: dx=48px → deltaTicks=480
    // computeLoopMove(0, 480, 480, 120) → {loopStart:480, loopEnd:960}
    act(() => {
      firePointerEvent(region, 'pointerdown', 50, 8)
      firePointerEvent(strip, 'pointermove', 98, 8)
      firePointerEvent(strip, 'pointerup', 98, 8)
    })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(480) // 480틱 이동
    expect(loopEndTicks).toBe(960) // 480 + 480 폭 보존
  })
})

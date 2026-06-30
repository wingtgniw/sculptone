import { describe, it, expect, vi, beforeEach } from 'vitest'

// metronome.ts는 'tone'을 top-level import하므로 jsdom 환경에서 vi.mock이 필요하다.
// 스파이 변수를 먼저 선언한 뒤 vi.mock 팩토리에서 참조한다.

const mockAccentTrigger = vi.fn()
const mockNormalTrigger = vi.fn()
const mockDispose = vi.fn()
let synthCallCount = 0

vi.mock('tone', () => ({
  Synth: vi.fn().mockImplementation(() => {
    synthCallCount++
    return {
      triggerAttackRelease: synthCallCount === 1 ? mockAccentTrigger : mockNormalTrigger,
      dispose: mockDispose,
      toDestination: vi.fn().mockReturnThis(),
    }
  }),
}))

import {
  beatDurationSec,
  barDurationSec,
  barsToSeconds,
  computeClickTimes,
  createMetronome,
} from '../metronome'

// ── beatDurationSec ───────────────────────────────────────────

describe('beatDurationSec', () => {
  it('120BPM → 0.5s', () => {
    expect(beatDurationSec(120)).toBeCloseTo(0.5)
  })

  it('60BPM → 1.0s', () => {
    expect(beatDurationSec(60)).toBeCloseTo(1.0)
  })

  it('90BPM → 2/3 s', () => {
    expect(beatDurationSec(90)).toBeCloseTo(60 / 90)
  })
})

// ── barDurationSec ────────────────────────────────────────────

describe('barDurationSec', () => {
  it('4/4 120BPM → 2.0s (4박 × 0.5s)', () => {
    expect(barDurationSec(120, [4, 4])).toBeCloseTo(2.0)
  })

  it('3/4 120BPM → 1.5s (3박 × 0.5s)', () => {
    expect(barDurationSec(120, [3, 4])).toBeCloseTo(1.5)
  })

  it('6/8 120BPM → 6박 × 0.5s = 3.0s', () => {
    // 여기서 박은 분모 단위(8분음표 단위 BPM) 아님 — 분자만 쓴다
    expect(barDurationSec(120, [6, 8])).toBeCloseTo(3.0)
  })
})

// ── barsToSeconds ─────────────────────────────────────────────

describe('barsToSeconds', () => {
  it('2마디 4/4 120BPM → 4.0s', () => {
    expect(barsToSeconds(2, 120, [4, 4])).toBeCloseTo(4.0)
  })

  it('1마디 3/4 120BPM → 1.5s', () => {
    expect(barsToSeconds(1, 120, [3, 4])).toBeCloseTo(1.5)
  })

  it('0마디 → 0s', () => {
    expect(barsToSeconds(0, 120, [4, 4])).toBe(0)
  })
})

// ── computeClickTimes ─────────────────────────────────────────

describe('computeClickTimes', () => {
  // 4/4 120BPM: 박 0.5s, 마디 2.0s
  it('4/4 120BPM 1마디 → 4박, 첫 박만 accent', () => {
    const clicks = computeClickTimes(120, [4, 4], 0, 2.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.timeSec).toBeCloseTo(0.5)
    expect(clicks[1]!.accent).toBe(false)
    expect(clicks[2]!.timeSec).toBeCloseTo(1.0)
    expect(clicks[2]!.accent).toBe(false)
    expect(clicks[3]!.timeSec).toBeCloseTo(1.5)
    expect(clicks[3]!.accent).toBe(false)
  })

  it('4/4 120BPM 2마디 → 8박, 마디 첫 박(0.0, 2.0)만 accent', () => {
    const clicks = computeClickTimes(120, [4, 4], 0, 4.0)
    expect(clicks).toHaveLength(8)
    expect(clicks[0]!.accent).toBe(true) // 0.0
    expect(clicks[1]!.accent).toBe(false) // 0.5
    expect(clicks[4]!.accent).toBe(true) // 2.0
    expect(clicks[5]!.accent).toBe(false) // 2.5
  })

  it('3/4 120BPM 1마디 → 3박, 첫 박만 accent', () => {
    const clicks = computeClickTimes(120, [3, 4], 0, 1.5)
    expect(clicks).toHaveLength(3)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.accent).toBe(false)
    expect(clicks[2]!.accent).toBe(false)
  })

  it('3/4 120BPM 2마디 → 6박, 0.0·1.5 accent', () => {
    const clicks = computeClickTimes(120, [3, 4], 0, 3.0)
    expect(clicks).toHaveLength(6)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[3]!.timeSec).toBeCloseTo(1.5)
    expect(clicks[3]!.accent).toBe(true)
  })

  it('durationSec = 0 → 빈 배열', () => {
    expect(computeClickTimes(120, [4, 4], 0, 0)).toEqual([])
  })

  it('durationSec < 0 → 빈 배열', () => {
    expect(computeClickTimes(120, [4, 4], 0, -1)).toEqual([])
  })

  it('경계: durationSec가 정확히 1박이면 1개만 반환', () => {
    // 4/4 120BPM: beatDur = 0.5s
    // fromSec=0, durationSec=0.5 → [0.0] 1개
    // 0.5s는 포함하지 않음([fromSec, fromSec+durationSec) 반-열린 구간)
    const clicks = computeClickTimes(120, [4, 4], 0, 0.5)
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
  })

  it('fromSec > 0: 카운트인 이후 콘텐츠 구간 클릭 — accent는 절대 마디 기준', () => {
    // 카운트인 2마디(4.0s) 후 콘텐츠 시작 → 콘텐츠 박 기준(0..durationSec)으로 반환
    // fromSec=4.0, 첫 박 timeSec=4.0, accent=true(새 마디 첫 박)
    const clicks = computeClickTimes(120, [4, 4], 4.0, 2.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(4.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.timeSec).toBeCloseTo(4.5)
    expect(clicks[1]!.accent).toBe(false)
  })

  it('fromSec가 박 중간이면 다음 박부터 반환', () => {
    // 4/4 120BPM: fromSec=0.25 (박 중간) → 첫 박(0.0)은 포함 안 됨, 0.5부터 시작
    const clicks = computeClickTimes(120, [4, 4], 0.25, 1.75)
    // 박 위치: 0.5, 1.0, 1.5, 2.0 → 0.25+1.75=2.0은 반열림이므로 제외 → 3개
    expect(clicks[0]!.timeSec).toBeCloseTo(0.5)
    expect(clicks[0]!.accent).toBe(false)
  })

  it('tempo=60, [4,4], 1마디 → 4박 at 0, 1, 2, 3s', () => {
    const clicks = computeClickTimes(60, [4, 4], 0, 4.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(0)
    expect(clicks[1]!.timeSec).toBeCloseTo(1)
    expect(clicks[2]!.timeSec).toBeCloseTo(2)
    expect(clicks[3]!.timeSec).toBeCloseTo(3)
  })
})

// ── createMetronome 스모크 ────────────────────────────────────

describe('createMetronome (Tone 스모크)', () => {
  beforeEach(() => {
    synthCallCount = 0
    vi.clearAllMocks()
  })

  it('click(time, true) 호출 시 첫 번째 Synth(accent)가 C5로 트리거된다', () => {
    const m = createMetronome()
    m.click(0.5, true)
    expect(mockAccentTrigger).toHaveBeenCalledWith('C5', '32n', 0.5)
  })

  it('click(time, false) 호출 시 두 번째 Synth(normal)가 C4로 트리거된다', () => {
    const m = createMetronome()
    m.click(1.0, false)
    expect(mockNormalTrigger).toHaveBeenCalledWith('C4', '32n', 1.0)
  })

  it('dispose() 호출 시 두 Synth(accent, normal)가 모두 dispose된다', () => {
    const m = createMetronome()
    m.dispose()
    expect(mockDispose).toHaveBeenCalledTimes(2)
  })
})

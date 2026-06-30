import * as Tone from 'tone'

/** 박자표: [분자, 분모]. 예: [4, 4], [3, 4], [6, 8]. */
export type TimeSignature = [number, number]

export interface ClickEvent {
  /** transport 기준 절대 위치(초) */
  timeSec: number
  /** 마디 첫 박이면 true */
  accent: boolean
}

// ── 순수 계산 ─────────────────────────────────────────────────

/**
 * 1박(4분음표)의 길이(초).
 * 주의: 박자표의 분모(4/8 등)를 별도로 보정하지 않는다 — BPM은 항상 4분음표 기준.
 */
export function beatDurationSec(tempo: number): number {
  return 60 / tempo
}

/**
 * 1마디의 길이(초).
 * beatsPerBar = timeSignature[0] (분자).
 */
export function barDurationSec(tempo: number, timeSignature: TimeSignature): number {
  return beatDurationSec(tempo) * timeSignature[0]
}

/**
 * N마디의 길이(초).
 */
export function barsToSeconds(bars: number, tempo: number, timeSignature: TimeSignature): number {
  return bars * barDurationSec(tempo, timeSignature)
}

/**
 * `fromSec`부터 `fromSec + durationSec` 구간(반-열린 구간)에 해당하는
 * 모든 박 클릭 이벤트를 반환한다.
 *
 * - 박 위치는 절대 시간 기준(transport seconds). 마디 첫 박(beatIndex % beatsPerBar === 0)은 accent=true.
 * - fromSec 이전 박은 포함하지 않는다.
 * - durationSec <= 0이면 빈 배열.
 * - fromSec가 박 중간이면 그 박은 건너뛰고 다음 박부터 반환.
 *
 * @param tempo        BPM (4분음표 기준)
 * @param timeSignature 박자표 [분자, 분모]
 * @param fromSec      구간 시작(초, 포함)
 * @param durationSec  구간 길이(초)
 */
export function computeClickTimes(
  tempo: number,
  timeSignature: TimeSignature,
  fromSec: number,
  durationSec: number,
): ClickEvent[] {
  if (durationSec <= 0) return []

  const beatDur = beatDurationSec(tempo)
  const barDur = barDurationSec(tempo, timeSignature)
  const beatsPerBar = timeSignature[0]

  const toSec = fromSec + durationSec
  const clicks: ClickEvent[] = []

  // fromSec 이후 첫 번째 박의 인덱스(절대 0 기준)
  // Math.ceil 대신 부동소수점 허용 오차 포함: fromSec가 박 위치와 거의 일치하면 그 박 포함
  const firstBeatIndex = Math.ceil((fromSec - 1e-9) / beatDur)

  for (let i = firstBeatIndex; ; i++) {
    const timeSec = i * beatDur
    if (timeSec >= toSec - 1e-9) break

    const beatInBar = Math.round((timeSec % barDur) / beatDur)
    const accent = beatInBar % beatsPerBar === 0

    clicks.push({ timeSec, accent })
  }

  return clicks
}

// ── Tone 클릭 사운드 (비순수부) ───────────────────────────────
// Tone은 파일 상단에서 import하지만, createMetronome() 호출(= new Tone.Synth())은
// 테스트 시 vi.mock('tone', ...) 으로 Synth 클래스가 교체된 후 실행된다.
// 순수 함수(computeClickTimes 등)는 Tone을 호출하지 않으므로 모킹 영향 없음.

export interface MetronomeHandle {
  /** transport.schedule 콜백 내부의 오디오 시간(time)에 클릭을 울린다. */
  click: (time: number, accent: boolean) => void
  dispose: () => void
}

/**
 * 클릭 사운드 엔진을 생성한다.
 * accent 클릭: C5, normal 클릭: C4. 각 Synth 인스턴스는 독립적으로 관리된다.
 *
 * 사용 패턴:
 *   const m = createMetronome()
 *   transport.schedule((time) => m.click(time, true), 0)
 *   // 재생 종료 후:
 *   m.dispose()
 */
export function createMetronome(): MetronomeHandle {
  const accentSynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
    volume: -6,
  }).toDestination()

  const normalSynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
    volume: -12,
  }).toDestination()

  return {
    click(time, accent) {
      const synth = accent ? accentSynth : normalSynth
      const note = accent ? 'C5' : 'C4'
      synth.triggerAttackRelease(note, '32n', time)
    },
    dispose() {
      accentSynth.dispose()
      normalSynth.dispose()
    },
  }
}

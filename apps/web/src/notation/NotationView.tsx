import { useEffect, useRef } from 'react'
import { Renderer, Stave, Voice, StaveNote, Formatter, Dot, StaveTie } from 'vexflow'
import { useStore } from '../state/store'
import { trackToNotation, midiToOctave } from '@sculptone/score-model'
import type { NotationElement } from '@sculptone/score-model'

// DurationType → VexFlow duration 문자열
const DUR_TO_VF: Record<string, string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
}

const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

/** MIDI pitch → VexFlow key 문자열 ("c/4", "c#/4", ...) */
function midiToVexKey(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  // J: Math.max 클램프 제거 — score-model 공유 헬퍼(MIDI 60→4 규약)로 통일
  const octave = midiToOctave(midi)
  return `${PITCH_NAMES[pc]!}/${octave}`
}

const MEASURE_WIDTH = 250
const STAVE_X_FIRST = 20
const STAVE_Y = 40

export function NotationView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const project         = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)

  const track = project.tracks.find((t) => t.id === selectedTrackId)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''

    if (!track || track.notes.length === 0) return

    try {
      const notation = trackToNotation(track, project.transport)
      if (notation.measures.length === 0) return

      const [numerator, denominator] = project.transport.timeSignature
      const totalWidth =
        STAVE_X_FIRST + notation.measures.length * MEASURE_WIDTH + 40

      const renderer = new Renderer(container, Renderer.Backends.SVG)
      renderer.resize(totalWidth, 160)
      const ctx = renderer.getContext()

      // I: 마디 간 타이 연결을 위해 직전 마디의 'start' StaveNote 참조를 유지
      let pendingTieNote: StaveNote | null = null

      for (let mi = 0; mi < notation.measures.length; mi++) {
        const measure = notation.measures[mi]!
        const x = mi === 0 ? STAVE_X_FIRST : STAVE_X_FIRST + mi * MEASURE_WIDTH
        const stave = new Stave(x, STAVE_Y, MEASURE_WIDTH)

        if (mi === 0) {
          stave.addClef('treble').addTimeSignature(`${numerator}/${denominator}`)
        }

        stave.setContext(ctx).draw()

        // I: 이 마디에서 draw할 타이 목록 (format 이후 위치가 확정된 뒤 draw)
        const tiesThisMeasure: Array<{ firstNote: StaveNote; lastNote: StaveNote }> = []

        const staveNotes = measure.elements.map((el: NotationElement) => {
          const vfDur = DUR_TO_VF[el.durationType] ?? 'q'
          if (el.kind === 'rest') {
            // H: rest 분기도 note처럼 변수로 받아 dots 처리
            const rn = new StaveNote({ keys: ['b/4'], duration: vfDur + 'r' })
            if (el.dots > 0) Dot.buildAndAttach([rn], { all: true })
            return rn
          }
          const keys = el.pitches.map(midiToVexKey)
          const sn = new StaveNote({ keys, duration: vfDur })
          if (el.dots > 0) Dot.buildAndAttach([sn], { all: true })

          // I: 타이 stop — 직전 마디의 start 노트와 연결
          if ((el.tie === 'stop' || el.tie === 'startstop') && pendingTieNote) {
            tiesThisMeasure.push({ firstNote: pendingTieNote, lastNote: sn })
            pendingTieNote = null
          }
          // I: 타이 start — 다음 마디의 stop 노트와 연결하기 위해 참조 보관
          if (el.tie === 'start' || el.tie === 'startstop') {
            pendingTieNote = sn
          }

          return sn
        })

        if (staveNotes.length > 0) {
          const voice = new Voice({ numBeats: numerator, beatValue: denominator })
          voice.setStrict(false).addTickables(staveNotes)
          new Formatter().joinVoices([voice]).format([voice], MEASURE_WIDTH - 40)
          voice.draw(ctx, stave)
        }

        // I: format/draw 이후 위치 확정된 뒤 타이 draw
        for (const { firstNote, lastNote } of tiesThisMeasure) {
          new StaveTie({
            firstNote,
            lastNote,
            firstIndexes: [0],
            lastIndexes: [0],
          })
            .setContext(ctx)
            .draw()
        }
      }
    } catch {
      // VexFlow 렌더 실패(jsdom 또는 DOM 미지원 환경)
      if (container) {
        container.innerHTML =
          '<p style="color:var(--text-lo);padding:16px;font-size:12px">악보를 렌더할 수 없습니다.</p>'
      }
    }
  }, [track, project.transport])

  return (
    <div
      ref={containerRef}
      data-testid="notation-view"
      style={{
        background: 'var(--bg-inset)',
        width: '100%',
        minHeight: 200,
        padding: 8,
        overflowX: 'auto',
        color: 'var(--text-hi)',
      }}
    />
  )
}

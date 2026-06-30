import type { ChangeEvent } from 'react'
import { useStore } from '../state/store'
import { Badge } from '../ui/Badge'

interface Props {
  onPlay: () => void
  onStop: () => void
}

export function TransportBar({ onPlay, onStop }: Props) {
  const isPlaying = useStore((s) => s.isPlaying)
  const isRecording = useStore((s) => s.isRecording)
  const metronomeEnabled = useStore((s) => s.metronomeEnabled)
  const countInBars = useStore((s) => s.countInBars)
  const setPlaying = useStore((s) => s.setPlaying)
  const setRecording = useStore((s) => s.setRecording)
  const setMetronomeEnabled = useStore((s) => s.setMetronomeEnabled)
  const setCountInBars = useStore((s) => s.setCountInBars)
  const tempo = useStore((s) => s.project.transport.tempo)

  const handlePlay = () => {
    setPlaying(true)
    onPlay()
  }
  const handleStop = () => {
    setPlaying(false)
    onStop()
  }
  const handleRecord = () => {
    setRecording(!isRecording)
  }
  const handleMetronome = () => {
    setMetronomeEnabled(!metronomeEnabled)
  }
  const handleCountIn = (e: ChangeEvent<HTMLSelectElement>) => {
    setCountInBars(Number(e.target.value))
  }

  const tbtn = {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: 0,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--bg-elevated)',
    color: 'var(--text-hi)',
  } as const

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: '100%',
      }}
    >
      {/* 녹음 버튼 */}
      <button
        aria-label="녹음"
        aria-pressed={isRecording}
        onClick={handleRecord}
        style={{
          ...tbtn,
          background: isRecording ? 'var(--record)' : 'var(--bg-elevated)',
          color: isRecording ? '#fff' : 'var(--text-hi)',
        }}
      >
        ⏺
      </button>

      {/* 재생 버튼 */}
      <button
        aria-label="재생"
        onClick={handlePlay}
        style={{
          ...tbtn,
          width: 46,
          height: 46,
          background: 'var(--accent)',
          color: 'var(--on-accent)',
        }}
      >
        ▶
      </button>

      {/* 정지 버튼 */}
      <button aria-label="정지" onClick={handleStop} style={tbtn}>
        ⏹
      </button>

      {/* 메트로놈 토글 */}
      <button
        aria-label="메트로놈"
        aria-pressed={metronomeEnabled}
        onClick={handleMetronome}
        style={{
          ...tbtn,
          background: metronomeEnabled ? 'var(--accent)' : 'var(--bg-elevated)',
          color: metronomeEnabled ? 'var(--on-accent)' : 'var(--text-hi)',
        }}
      >
        ♩
      </button>

      {/* 카운트인 선택 */}
      <select
        aria-label="카운트인"
        value={countInBars}
        disabled={!metronomeEnabled}
        onChange={handleCountIn}
        style={{
          font: 'inherit',
          fontSize: 11,
          padding: '2px 4px',
          borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)',
          cursor: metronomeEnabled ? 'pointer' : 'default',
          background: 'var(--bg-elevated)',
          color: 'var(--text-mid)',
        }}
      >
        <option value={0}>카운트인 없음</option>
        <option value={1}>1마디</option>
        <option value={2}>2마디</option>
      </select>

      {/* 템포 + 재생 상태 */}
      <span className="mono" style={{ marginLeft: 10, color: 'var(--text-mid)', fontSize: 13 }}>
        {tempo} BPM {isPlaying ? '· ▶' : ''}
      </span>

      {isRecording && <Badge tone="rec">REC</Badge>}
    </div>
  )
}

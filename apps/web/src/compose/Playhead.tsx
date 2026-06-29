import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { tickToX } from './geometry'
import { secondsToTicks } from './time'

interface Props { getSeconds: () => number }

export function Playhead({ getSeconds }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const isPlaying = useStore((s) => s.isPlaying)
  const ppq = useStore((s) => s.project.transport.ppq)
  const tempo = useStore((s) => s.project.transport.tempo)

  useEffect(() => {
    if (!isPlaying) {
      if (ref.current) {
        const ticks = secondsToTicks(getSeconds(), ppq, tempo)
        ref.current.style.transform = `translateX(${tickToX(ticks, ppq)}px)`
      }
      return
    }
    let raf = 0
    const tick = () => {
      const ticks = secondsToTicks(getSeconds(), ppq, tempo)
      if (ref.current) ref.current.style.transform = `translateX(${tickToX(ticks, ppq)}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, getSeconds, ppq, tempo])

  return (
    <div ref={ref} data-testid="playhead" style={{
      position: 'absolute', top: 0, bottom: 0, left: 0, width: 2,
      background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)', pointerEvents: 'none',
    }} />
  )
}

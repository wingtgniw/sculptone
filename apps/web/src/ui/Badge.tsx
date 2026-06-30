import type { ReactNode } from 'react'

interface Props {
  tone?: 'rec' | 'neutral'
  children: ReactNode
}

export function Badge({ tone = 'neutral', children }: Props) {
  const color = tone === 'rec' ? 'var(--record)' : 'var(--text-mid)'
  const bg = tone === 'rec' ? 'rgba(226,104,95,.12)' : 'var(--bg-elevated)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 'var(--r-pill)',
        color,
        background: bg,
      }}
    >
      {children}
    </span>
  )
}

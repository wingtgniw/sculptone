import type { ButtonHTMLAttributes, CSSProperties } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const styles: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--on-accent)' },
  secondary: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-hi)',
    border: '1px solid var(--border-strong)',
  },
  ghost: { background: 'transparent', color: 'var(--text-mid)' },
  danger: {
    background: 'transparent',
    color: 'var(--record)',
    border: '1px solid rgba(226,104,95,.4)',
  },
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', style, children, ...rest }: Props) {
  return (
    <button
      data-variant={variant}
      style={{
        font: 'inherit',
        fontWeight: 600,
        fontSize: 14,
        borderRadius: 'var(--r-md)',
        padding: '10px 18px',
        border: '1px solid transparent',
        cursor: 'pointer',
        ...styles[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

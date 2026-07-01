import type { CSSProperties } from 'react'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 12,
  background: 'var(--bg-base)',
  color: 'var(--text-mid)',
}

interface Props {
  message: string | null
}

export function ShareErrorScreen({ message }: Props) {
  return (
    <div style={containerStyle}>
      <strong style={{ fontSize: 18 }}>Sculptone</strong>
      <span style={{ fontSize: 14, color: 'var(--record)' }}>
        {message ?? '공유 링크가 유효하지 않습니다.'}
      </span>
      <a
        href={window.location.origin}
        style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'underline' }}
      >
        앱으로 돌아가기
      </a>
    </div>
  )
}

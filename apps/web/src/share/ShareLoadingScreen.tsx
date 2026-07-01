import type { CSSProperties } from 'react'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 16,
  background: 'var(--bg-base)',
  color: 'var(--text-mid)',
}

export function ShareLoadingScreen() {
  return (
    <div style={containerStyle}>
      <strong style={{ fontSize: 18 }}>Sculptone</strong>
      <span style={{ fontSize: 14 }}>공유 프로젝트를 불러오는 중...</span>
    </div>
  )
}

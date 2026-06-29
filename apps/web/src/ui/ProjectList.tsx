import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { listProjects, loadProject, type ProjectSummary } from '../io/storage'

export function ProjectList() {
  const replaceProject = useStore((s) => s.replaceProject)
  const [items, setItems]   = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    void listProjects().then((list) => {
      setItems(list)
      setLoading(false)
    })
  }, [])

  const handleLoad = async (id: string) => {
    try {
      const p = await loadProject(id)
      if (p) replaceProject(p)
    } catch {
      setError('프로젝트를 열 수 없습니다')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        로딩 중…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        저장된 프로젝트 없음
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0', minWidth: 220 }}>
      <p style={{
        fontSize: 11, color: 'var(--text-lo)',
        textTransform: 'uppercase', letterSpacing: '.1em',
        margin: '0 12px 8px',
      }}>
        Saved Projects
      </p>
      {error && (
        <p style={{ fontSize: 11, color: 'var(--record)', margin: '0 12px 8px' }}>
          {error}
        </p>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', gap: 8,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-hi)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          <button
            aria-label={`Load ${item.title}`}
            onClick={() => void handleLoad(item.id)}
            style={{
              font: 'inherit', fontSize: 11, fontWeight: 600,
              padding: '3px 8px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border-strong)',
              cursor: 'pointer',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            Load
          </button>
        </div>
      ))}
    </div>
  )
}

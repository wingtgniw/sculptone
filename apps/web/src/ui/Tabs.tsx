export interface TabItem {
  id: string
  label: string
  disabled?: boolean
}

interface Props {
  items: TabItem[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ items, active, onChange }: Props) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 4 }}>
      {items.map((it) => {
        const selected = it.id === active
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={selected}
            disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.id)}
            style={{
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              padding: '7px 16px',
              borderRadius: 'var(--r-pill)',
              border: 0,
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              opacity: it.disabled ? 0.4 : 1,
              background: selected ? 'var(--accent)' : 'transparent',
              color: selected ? '#1a1206' : 'var(--text-mid)',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

import { useEffect, useState, type ChangeEvent } from 'react'
import { useStore } from '../state/store'
import { updateTrackSound } from '@sculptone/score-model'
import {
  savePatch,
  listPatches,
  loadPatch,
  deletePatch,
  type PatchSummary,
} from '../io/patch-storage'
import type { Sound } from '@sculptone/score-model'

// ── 스타일 상수 ────────────────────────────────────────────────

const labelStyle = {
  fontSize: 11,
  color: 'var(--text-lo)',
  display: 'block',
  marginBottom: 4,
  textTransform: 'uppercase' as const,
  letterSpacing: '.08em',
  margin: 0,
}

const microBtnBase = {
  font: 'inherit',
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}

// ── 컴포넌트 ──────────────────────────────────────────────────

interface Props {
  trackId: string
  currentSound: Sound
}

/**
 * 패치 라이브러리 패널 — SoundDesignPanel 내 임베드용.
 * - Save 섹션: 이름 input + Save 버튼(빈 이름 = disabled)
 * - 목록 섹션: 저장된 패치 리스트, 각 항목에 Load / Delete 버튼
 */
export function PatchLibrary({ trackId, currentSound }: Props) {
  // project 구독 제거: handleLoad 에서 getState()로 최신값 읽어 stale 방지
  const setProject = useStore((s) => s.setProject)

  const [patches, setPatches] = useState<PatchSummary[]>([])
  const [patchName, setPatchName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    void listPatches()
      .then((list) => {
        setPatches(list)
        setError(null)
      })
      .catch(() => {
        setError('패치 목록을 불러오지 못했습니다')
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    const trimmed = patchName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await savePatch(trimmed, currentSound)
      setPatchName('')
      setError(null)
      refresh()
    } catch {
      setError('패치 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async (id: string) => {
    try {
      const sound = await loadPatch(id)
      if (sound) {
        // await 후 최신 project를 getState()로 읽어 stale 스냅샷 방지
        const cur = useStore.getState().project
        setProject(updateTrackSound(cur, trackId, sound))
      }
      setError(null)
    } catch {
      setError('패치를 불러오지 못했습니다(손상/비호환)')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deletePatch(id)
      setError(null)
      refresh()
    } catch {
      setError('패치 삭제 실패')
    }
  }

  return (
    <section
      aria-label="Patch Library"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {/* ── Save 섹션 ── */}
      <p style={labelStyle}>Save Current Patch</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          aria-label="Patch name"
          value={patchName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPatchName(e.target.value)}
          placeholder="Patch name…"
          style={{
            flex: 1,
            font: 'inherit',
            fontSize: 11,
            padding: '4px 6px',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-mid)',
          }}
        />
        <button
          aria-label="Save patch"
          disabled={!patchName.trim() || saving}
          onClick={() => void handleSave()}
          style={{
            ...microBtnBase,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            opacity: !patchName.trim() || saving ? 0.5 : 1,
          }}
        >
          Save
        </button>
      </div>

      {/* ── 에러 표시 ── */}
      {error && (
        <p role="alert" style={{ fontSize: 11, color: 'var(--record)', margin: 0 }}>
          {error}
        </p>
      )}

      {/* ── Saved Patches 목록 ── */}
      <p style={{ ...labelStyle, marginTop: 6 }}>Saved Patches</p>
      {loading ? (
        <p style={{ fontSize: 11, color: 'var(--text-lo)', margin: 0 }}>로딩…</p>
      ) : patches.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-lo)', margin: 0 }}>저장된 패치 없음</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {patches.map((patch) => (
            <li
              key={patch.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: 'var(--text-hi)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {patch.name}
              </span>
              <button
                aria-label={`Load patch ${patch.name}`}
                onClick={() => void handleLoad(patch.id)}
                style={{
                  ...microBtnBase,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                Load
              </button>
              <button
                aria-label={`Delete patch ${patch.name}`}
                onClick={() => void handleDelete(patch.id)}
                style={{
                  ...microBtnBase,
                  background: 'transparent',
                  color: 'var(--text-lo)',
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

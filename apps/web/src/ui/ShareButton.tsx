import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import { useAuthStore } from '../cloud/authStore'
import { isCloudConfigured, supabase } from '../cloud/supabase'
import { shareProject, unshareProject } from '../cloud/shareRepo'

const btnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  whiteSpace: 'nowrap',
}

const activeBtnStyle: CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  borderColor: 'var(--accent)',
}

/**
 * Share / Unshare 버튼.
 * isCloudConfigured() + signedIn 상태일 때만 렌더(아니면 null).
 * 현재 프로젝트의 share_token을 조회해 공유 상태 표시.
 *
 * graceful degradation: isCloudConfigured=false 또는 미로그인 → null 렌더.
 */
export function ShareButton() {
  // 모든 훅을 선언부에서 호출 (Rules of Hooks 준수)
  const status = useAuthStore((s) => s.status)
  const projectId = useStore((s) => s.project.id)

  const [shareToken, setShareToken] = useState<string | null | 'loading'>('loading')
  const [isActing, setIsActing] = useState(false)
  const [showPopover, setShowPopover] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 현재 프로젝트의 share_token 조회
  useEffect(() => {
    if (!supabase || status !== 'signedIn') {
      setShareToken(null)
      return
    }
    setShareToken('loading')
    void (async () => {
      try {
        const { data } = await supabase.from('projects').select('share_token').eq('id', projectId)
        const row = (data as Array<{ share_token: string | null }> | null)?.[0]
        setShareToken(row?.share_token ?? null)
      } catch {
        setShareToken(null)
      }
    })()
  }, [projectId, status])

  // Supabase 미설정 또는 미로그인 → 렌더하지 않음
  if (!isCloudConfigured() || status !== 'signedIn') return null

  const shareUrl =
    shareToken && shareToken !== 'loading' ? `${window.location.origin}?share=${shareToken}` : null

  const handleShare = async () => {
    setIsActing(true)
    try {
      const token = await shareProject(projectId)
      setShareToken(token)
      const url = `${window.location.origin}?share=${token}`
      try {
        await navigator.clipboard.writeText(url)
        setCopyMsg('링크가 복사됐습니다!')
      } catch {
        setCopyMsg(null)
      }
      setShowPopover(true)
    } catch (e) {
      console.error('[ShareButton] shareProject failed:', e)
    } finally {
      setIsActing(false)
    }
  }

  const handleUnshare = async () => {
    setIsActing(true)
    try {
      await unshareProject(projectId)
      setShareToken(null)
      setShowPopover(false)
      setCopyMsg(null)
    } catch (e) {
      console.error('[ShareButton] unshareProject failed:', e)
    } finally {
      setIsActing(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      {shareToken && shareToken !== 'loading' ? (
        <button
          style={activeBtnStyle}
          onClick={() => setShowPopover((v) => !v)}
          disabled={isActing}
          aria-label="공유 중 (클릭으로 옵션 열기)"
        >
          Shared
        </button>
      ) : (
        <button
          style={btnStyle}
          onClick={handleShare}
          disabled={isActing || shareToken === 'loading'}
        >
          {isActing ? 'Sharing...' : 'Share'}
        </button>
      )}

      {showPopover && shareUrl && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            padding: '10px 12px',
            zIndex: 100,
            minWidth: 260,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-mid)' }}>공유 링크</div>
          <div
            style={{
              fontSize: 11,
              wordBreak: 'break-all',
              color: 'var(--text-base)',
              marginBottom: 8,
              padding: '4px 6px',
              background: 'var(--bg-inset)',
              borderRadius: 4,
            }}
          >
            {shareUrl}
          </div>
          {copyMsg && (
            <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>{copyMsg}</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...btnStyle, fontSize: 11 }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl)
                  setCopyMsg('링크가 복사됐습니다!')
                } catch {
                  /* clipboard 미지원 */
                }
              }}
            >
              복사
            </button>
            <button
              style={{ ...btnStyle, fontSize: 11, color: 'var(--record)' }}
              onClick={handleUnshare}
              disabled={isActing}
            >
              {isActing ? '해제 중...' : 'Unshare'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

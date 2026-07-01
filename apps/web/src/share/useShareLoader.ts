import { useState, useEffect, useRef } from 'react'
import { parseShareToken } from './parseShareToken'
import { fetchSharedProject } from '../cloud/shareRepo'
import { isCloudConfigured } from '../cloud/supabase'
import { useShareStore } from '../cloud/shareStore'

/**
 * 공유 URL 감지·로드 훅. App.tsx 최상단에서 한 번만 호출한다.
 *
 * 반환값: Status — App.tsx가 렌더할 셸을 결정하는 데 사용.
 *
 * Fix D — 동기 초기 상태:
 *   useState lazy initializer로 첫 렌더 전에 status를 결정.
 *   토큰 있음 + 클라우드 설정 → 즉시 'loading'. AppShell이 한 프레임도 마운트되지 않음.
 *
 * Fix E — 미설정 graceful degradation:
 *   isCloudConfigured()=false이면 토큰을 무시하고 'none'. 로컬 앱 정상 부팅.
 *
 * Fix F — StrictMode 이중 마운트 방어:
 *   useRef(false) 가드로 effect가 재실행돼도 fetch는 최초 1회만.
 */
export type ShareStatus = 'none' | 'loading' | 'loaded' | 'error'

export function useShareLoader(): ShareStatus {
  // 동기 초기 상태 결정 (Fix D + E)
  const [status, setStatus] = useState<ShareStatus>(() => {
    const token = parseShareToken(window.location.href)
    return token && isCloudConfigured() ? 'loading' : 'none'
  })

  // StrictMode 이중 마운트 방어 (Fix F)
  const fetchedRef = useRef(false)

  const { setSharedProject, setShareError, setReadOnly } = useShareStore()

  useEffect(() => {
    // 토큰이 없거나 미설정인 경우 → 'none'으로 초기화되어 여기 진입 안 함
    if (status !== 'loading') return

    // StrictMode 이중 실행 차단
    if (fetchedRef.current) return
    fetchedRef.current = true

    const token = parseShareToken(window.location.href)
    if (!token) {
      // lazy init이 'loading'을 반환했다면 반드시 token이 있어야 하지만, 방어적 처리
      setStatus('error')
      setShareError('토큰을 파싱할 수 없습니다.')
      return
    }

    fetchSharedProject(token)
      .then((project) => {
        if (!project) {
          setShareError('공유 링크가 유효하지 않습니다.')
          setStatus('error')
          return
        }
        setSharedProject(project)
        setReadOnly(true)
        setStatus('loaded')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
        setShareError(msg)
        setStatus('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 마운트 시 1회 실행 (useRef 가드로 StrictMode 이중 fetch 방지)

  return status
}

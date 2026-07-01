import { useEffect } from 'react'
import { useAuthStore } from './authStore'
import { syncNow } from './sync'

/**
 * authStore.status가 'signedIn'으로 전환될 때 syncNow()를 1회 호출한다.
 * AppShell 최상단에 마운트. sync.ts에서 authStore를 직접 구독하지 않아 순환 의존 방지.
 */
export function useCloudSync(): void {
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (status === 'signedIn') {
      void syncNow()
    }
  }, [status])
}

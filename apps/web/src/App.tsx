import { AppShell } from './shell/AppShell'
import { useShareLoader } from './share/useShareLoader'
import { useShareStore } from './cloud/shareStore'
import { ShareViewerShell } from './share/ShareViewerShell'
import { ShareLoadingScreen } from './share/ShareLoadingScreen'
import { ShareErrorScreen } from './share/ShareErrorScreen'

/**
 * Fix D: useShareLoader가 동기적으로 초기 status를 결정하므로
 *   토큰이 URL에 있으면 첫 렌더부터 AppShell이 마운트되지 않는다.
 *   status='loading'|'error'|'loaded' → 각 공유 화면
 *   status='none'                     → 로컬 앱(AppShell)
 */
export default function App() {
  const status = useShareLoader()
  const shareError = useShareStore((s) => s.shareError)

  if (status === 'loading') return <ShareLoadingScreen />
  if (status === 'error') return <ShareErrorScreen message={shareError} />
  if (status === 'loaded') return <ShareViewerShell />

  // status === 'none' → 토큰 없음 또는 미설정 → 로컬 앱
  return <AppShell />
}

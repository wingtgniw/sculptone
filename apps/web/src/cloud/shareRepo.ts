import { deserializeProject, type Project } from '@sculptone/score-model'
import { supabase } from './supabase'
import { useAuthStore } from './authStore'

/**
 * 클라이언트에서 추측불가 32자 hex 토큰을 생성한다.
 * crypto.getRandomValues: 128비트 엔트로피 (CSPRNG).
 */
function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 프로젝트에 공유 토큰을 발급한다(멱등).
 * - supabase null → throw (소유자 전용 기능, graceful degradation 불필요)
 * - 기존 토큰 있으면 반환 (재발급 없음)
 * - 없으면 신규 생성 후 UPDATE, 토큰 반환
 */
export async function shareProject(id: string): Promise<string> {
  if (!supabase) throw new Error('[shareRepo] Cloud not configured')

  const { user } = useAuthStore.getState()
  if (!user) throw new Error('[shareRepo] Not signed in')

  // 1. 기존 share_token 조회
  const { data: rows, error: selectErr } = await supabase
    .from('projects')
    .select('share_token')
    .eq('id', id)
    .eq('owner', user.id)

  if (selectErr) {
    console.error('[shareRepo] shareProject select failed:', selectErr)
    throw new Error(selectErr.message)
  }

  const row = (rows as Array<{ share_token: string | null }> | null)?.[0]
  if (row?.share_token) {
    // 이미 공유 중 → 기존 토큰 반환 (멱등)
    return row.share_token
  }

  // 2. 신규 토큰 생성 + UPDATE (.select('id') 로 영향 행 수 확인)
  const token = generateShareToken()
  const { data: updatedRows, error: updateErr } = await supabase
    .from('projects')
    .update({ share_token: token })
    .eq('id', id)
    .eq('owner', user.id)
    .select('id')

  if (updateErr) {
    console.error('[shareRepo] shareProject update failed:', updateErr)
    throw new Error(updateErr.message)
  }

  const affected = updatedRows as Array<{ id: string }> | null
  if (!affected || affected.length === 0) {
    // 0행 매칭: 프로젝트가 없거나 소유자가 아님 → 토큰 저장 실패
    throw new Error('[shareRepo] shareProject: row not found or not owned by current user')
  }

  return token
}

/**
 * 공유 토큰을 제거한다(공유 해제).
 * - supabase null → no-op (graceful degradation)
 * - share_token을 null로 UPDATE → 기존 링크 무효화
 */
export async function unshareProject(id: string): Promise<void> {
  if (!supabase) return

  const { user } = useAuthStore.getState()
  if (!user) return

  const { data: updatedRows, error } = await supabase
    .from('projects')
    .update({ share_token: null })
    .eq('id', id)
    .eq('owner', user.id)
    .select('id')

  if (error) {
    console.error('[shareRepo] unshareProject failed:', error)
    throw new Error(error.message)
  }

  const affected = updatedRows as Array<{ id: string }> | null
  if (!affected || affected.length === 0) {
    throw new Error('[shareRepo] unshareProject: row not found or not owned by current user')
  }
}

/**
 * 토큰으로 공유 프로젝트를 읽어온다.
 * - supabase null → null (graceful degradation: 미설정 앱에서 뷰어 진입 무시)
 * - security-definer RPC 호출: 정확한 토큰 없이는 어떤 행도 반환하지 않음
 * - 미로그인(anon)도 동작: anon key에 get_shared_project execute 권한 있음
 * - 결과 없음 → null (토큰 무효 또는 공유 해제)
 * - 에러 → console.error + null (에러 전파 없음, 호출자가 에러 UI 처리)
 */
export async function fetchSharedProject(token: string): Promise<Project | null> {
  if (!supabase) return null

  try {
    const { data, error } = await supabase.rpc('get_shared_project', { p_token: token })

    if (error) {
      console.error('[shareRepo] fetchSharedProject rpc failed:', error)
      return null
    }

    const rows = data as Array<{ data: unknown }> | null
    if (!rows || rows.length === 0) return null

    const row = rows[0]!
    return deserializeProject(JSON.stringify(row.data))
  } catch (e) {
    console.error('[shareRepo] fetchSharedProject exception:', e)
    return null
  }
}

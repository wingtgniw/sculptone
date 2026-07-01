import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Vite 환경변수에서 Supabase 접속 정보를 읽는다.
 * 두 변수가 모두 truthy일 때만 createClient를 호출한다.
 * 하나라도 없으면 null — import 시점 크래시 없음.
 *
 * 로컬 개발: apps/web/.env.local 에 변수 설정
 * 설정 가이드: apps/web/.env.example 참조
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase 클라이언트 싱글톤.
 * - non-null: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY 둘 다 설정됨 → 클라우드 모드.
 * - null: 하나 이상 미설정 또는 malformed URL → 로컬 전용 모드(앱은 정상 동작, 인증 UI 숨김).
 */
let _client: SupabaseClient | null = null
if (url && key) {
  try {
    _client = createClient(url, key)
  } catch (e) {
    console.warn('Supabase disabled: invalid config', e)
  }
}
export const supabase: SupabaseClient | null = _client

/**
 * Supabase 클라이언트가 설정됐는지 여부.
 * true → 클라우드 기능(인증·동기화) 사용 가능.
 * false → 로컬 전용 모드.
 */
export function isCloudConfigured(): boolean {
  return supabase !== null
}

import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AuthStatus = 'disabled' | 'loading' | 'signedOut' | 'signedIn'

export interface AuthUser {
  id: string
  email: string | null
  avatarUrl: string | null
}

/** Supabase User → AuthUser 변환 */
function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    // user_metadata.avatar_url: Google/GitHub OAuth에서 제공
    avatarUrl: (user.user_metadata?.['avatar_url'] as string | undefined) ?? null,
  }
}

interface AuthState {
  /** 인증 상태 기계. 초기값: supabase 설정 여부에 따라 'disabled'|'loading'. */
  status: AuthStatus
  /** 현재 로그인 유저. signedIn 상태에서만 non-null. */
  user: AuthUser | null
  /** 마지막 signIn/signOut 오류 메시지. null = 없음. 다음 성공 시 초기화. */
  error: string | null
  /**
   * 세션 복원 + onAuthStateChange 구독.
   * 반환값: 정리 함수 (useEffect return으로 직접 사용 가능).
   * supabase === null(disabled) 시: 즉시 no-op 정리 함수 반환.
   */
  init: () => () => void
  /**
   * 소셜 OAuth 로그인 시작.
   * signInWithOAuth는 페이지를 provider로 리다이렉트하므로,
   * 이 함수가 반환된 후 앱이 OAuth 결과를 받아 onAuthStateChange가 status를 갱신.
   * supabase === null 시: no-op.
   */
  signIn: (provider: 'google' | 'github') => Promise<void>
  /**
   * 로그아웃.
   * 성공: status='signedOut', user=null.
   * 실패: status 복구, error 설정.
   * supabase === null 시: no-op.
   */
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // supabase가 null이면 disabled(미설정), non-null이면 loading(세션 복원 대기)
  status: supabase !== null ? 'loading' : 'disabled',
  user: null,
  error: null,

  init: () => {
    if (!supabase) return () => {}

    // 1. 현재 세션 복원 (페이지 새로고침 후 로그인 상태 유지)
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session?.user) {
          set({ status: 'signedIn', user: toAuthUser(session.user) })
        } else {
          // Fix 2: user: null 명시 — stale user가 남지 않도록 불변식 유지
          set({ status: 'signedOut', user: null })
        }
      })
      // Fix 3: reject 시 loading 영구 고착 방지 — signedOut으로 회복
      .catch(() => set({ status: 'signedOut', user: null }))

    // 2. 인증 상태 변경 실시간 구독 (OAuth 복귀, 세션 만료 등)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        set({ status: 'signedIn', user: toAuthUser(session.user) })
      } else {
        set({ status: 'signedOut', user: null })
      }
    })

    // 3. 정리 함수 반환: useEffect(() => init(), []) 으로 마운트/언마운트 대칭 처리
    return () => subscription.unsubscribe()
  },

  signIn: async (provider) => {
    if (!supabase) return
    // 이전 에러 초기화
    set({ error: null })
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // OAuth 완료 후 앱으로 복귀할 URL
          redirectTo: window.location.origin,
        },
      })
      if (error) throw error
      // 성공 시: 브라우저가 provider로 리다이렉트됨
      // status는 앱이 복귀한 후 onAuthStateChange 콜백에서 'signedIn'으로 전환
    } catch (e) {
      set({ status: 'signedOut', error: (e as Error).message })
    }
  },

  signOut: async () => {
    if (!supabase) return
    const prevStatus = get().status
    set({ status: 'loading', error: null })
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      set({ status: 'signedOut', user: null })
    } catch (e) {
      // 오류 시 이전 상태 복구
      set({ status: prevStatus, error: (e as Error).message })
    }
  },
}))

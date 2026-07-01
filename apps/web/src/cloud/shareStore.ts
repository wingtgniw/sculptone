import { create } from 'zustand'
import type { Project } from '@sculptone/score-model'

export type ShareLoadState = 'idle' | 'loading' | 'loaded' | 'error'

interface ShareState {
  /** URL에 ?share=<token>이 감지되면 true. 읽기전용 뷰어 진입 플래그. */
  isReadOnly: boolean
  /** 공유 프로젝트 로드 상태 기계. */
  shareLoadState: ShareLoadState
  /** 로드된 공유 프로젝트. shareLoadState='loaded'일 때만 non-null. */
  sharedProject: Project | null
  /** 에러 메시지. shareLoadState='error'일 때만 non-null. */
  shareError: string | null
  setReadOnly: (v: boolean) => void
  setShareLoadState: (s: ShareLoadState) => void
  setSharedProject: (p: Project | null) => void
  setShareError: (msg: string | null) => void
}

export const useShareStore = create<ShareState>((set) => ({
  isReadOnly: false,
  shareLoadState: 'idle',
  sharedProject: null,
  shareError: null,
  setReadOnly: (v) => set({ isReadOnly: v }),
  setShareLoadState: (s) => set({ shareLoadState: s }),
  setSharedProject: (p) => set({ sharedProject: p }),
  setShareError: (msg) => set({ shareError: msg }),
}))

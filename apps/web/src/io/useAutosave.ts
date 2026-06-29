import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { saveProject } from './storage'
import type { Project } from '@sculptone/score-model'

/**
 * project가 변경될 때마다 debounce(delayMs) 후 saveProject를 호출한다.
 * AppShell 최상단에서 한 번 호출하면 된다.
 *
 * - 최초 마운트에서는 저장하지 않는다(빈 세션마다 새 레코드 누적 방지).
 * - 프로젝트가 교체되면(project.id 변경) 이전 프로젝트를 즉시 플러시한다(마지막 편집 유실 방지).
 * - saveProject 실패는 console.error로 보고한다(조용한 유실/unhandled rejection 방지).
 */
export function useAutosave(delayMs = 800): void {
  const project = useStore((s) => s.project)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRef = useRef(true)
  const prevProjectRef = useRef<Project>(project)

  useEffect(() => {
    // 최초 마운트에서는 저장하지 않는다.
    if (isFirstRef.current) {
      isFirstRef.current = false
      prevProjectRef.current = project
      return
    }

    // 프로젝트 전환(id 변경) 시 이전 프로젝트를 즉시 플러시한다.
    const prev = prevProjectRef.current
    if (prev.id !== project.id) {
      void saveProject(prev).catch((err) => console.error('autosave flush failed', err))
    }
    prevProjectRef.current = project

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      saveProject(project).catch((err) => console.error('autosave failed', err))
    }, delayMs)

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [project, delayMs])
}

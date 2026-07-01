import { deserializeProject, type Project } from '@sculptone/score-model'
import { isCloudConfigured } from './supabase'
import { useAuthStore } from './authStore'
import { fetchCloudProjects, upsertCloudProject, type CloudProjectRow } from './projectsRepo'
import { reconcile } from './reconcile'
import { listProjects, loadProject, saveProjectRaw } from '../io/storage'
import { useStore } from '../state/store'

/** pushProject 디바운스 딜레이(ms). autosave(800ms)보다 길게 설정해 로컬 저장 완료 후 업로드. */
const PUSH_DEBOUNCE_MS = 2000

/**
 * 프로젝트 id별 디바운스 타이머 맵. 각 id가 독립적으로 debounce된다.
 * 단일 타이머를 공유하면 프로젝트 전환 시 이전 프로젝트 업로드가 취소되는 버그가 발생한다(Fix B).
 */
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 프로젝트 id별 최신 Project 객체. 타이머 발화 시 가장 마지막에 push된 버전을 업로드한다. */
const pushProjects = new Map<string, Project>()

/**
 * 로컬 ↔ 클라우드 전체 동기화.
 * signedIn + isCloudConfigured() 일 때만 실행. 그 외 즉시 return(no-op).
 * 에러: console.error 로그 후 전파 안 함(다음 syncNow 기회에 자연 재시도).
 *
 * 삭제 전파 없음: reconcile 결과에 삭제 정보가 없으며 deleteCloudProject를 호출하지 않음.
 */
export async function syncNow(): Promise<void> {
  const { status, user } = useAuthStore.getState()
  if (status !== 'signedIn' || !user || !isCloudConfigured()) return

  // 1. 로컬 + 클라우드 목록 병렬 조회
  // fetchCloudProjects 쿼리 에러 시 throw → 빈 클라우드 오인 방지(Fix D): 조기 종료
  let localSummaries: Awaited<ReturnType<typeof listProjects>>
  let cloudRows: CloudProjectRow[]
  try {
    const result = await Promise.all([listProjects(), fetchCloudProjects()])
    localSummaries = result[0]
    cloudRows = result[1]
  } catch (e) {
    console.warn('[sync] syncNow: failed to fetch project lists, skipping sync:', e)
    return
  }

  try {
    // 2. LWW reconcile (epoch 기반 비교: ISO 8601 포맷 불일치 방어)
    const localMeta = localSummaries.map((s) => ({ id: s.id, updatedAt: s.updatedAt }))
    const cloudMeta = cloudRows.map((r) => ({ id: r.id, updatedAt: r.updated_at }))
    const { toUpload, toDownload } = reconcile(localMeta, cloudMeta)

    // 3. 다운로드: 클라우드 → 로컬 (saveProjectRaw: updatedAt 보존 → 재업로드 방지)
    for (const id of toDownload) {
      const row = cloudRows.find((r) => r.id === id)
      if (!row) continue // 방어 코드
      try {
        const project = deserializeProject(JSON.stringify(row.data))
        await saveProjectRaw(project)
        // Fix E: 현재 편집 중인 프로젝트이면 스토어 갱신(stale 덮어쓰기 방지)
        if (useStore.getState().project?.id === id) {
          useStore.getState().replaceProject(project)
        }
      } catch (e) {
        console.error(`[sync] download failed for ${id}:`, e)
      }
    }

    // 4. 업로드: 로컬 → 클라우드
    // Fix C: loadProject를 per-item try/catch 안으로 이동 — 1건 실패가 전체를 중단하지 않음
    for (const id of toUpload) {
      try {
        const project = await loadProject(id)
        if (!project) continue // 방어 코드
        await upsertCloudProject(project, user.id)
      } catch (e) {
        console.warn(`[sync] upload failed for ${id}:`, e)
      }
    }
  } catch (e) {
    console.error('[sync] syncNow failed:', e)
  }
}

/**
 * 단일 프로젝트를 클라우드에 디바운스 업로드한다.
 * signedIn + isCloudConfigured() 일 때만 실행. 그 외 즉시 return(no-op).
 * 프로젝트 id별 독립 디바운스(Fix B): 서로 다른 프로젝트는 타이머를 공유하지 않는다.
 *
 * 콜백 실행 시점에 status를 재확인한다: 타이머 예약 후 로그아웃 시 no-op.
 * useAutosave가 saveProject 성공 후 이 함수를 호출한다.
 * 에러: fire-and-forget (console.error만).
 */
export function pushProject(project: Project): void {
  const { status, user } = useAuthStore.getState()
  if (status !== 'signedIn' || !user || !isCloudConfigured()) return

  const id = project.id

  // 동일 id의 이전 예약 취소 (debounce)
  const existingTimer = pushTimers.get(id)
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer)
  }

  // 최신 project 보관 (타이머 발화 시 이 버전을 업로드)
  pushProjects.set(id, project)

  pushTimers.set(
    id,
    setTimeout(() => {
      pushTimers.delete(id)
      const latestProject = pushProjects.get(id)
      pushProjects.delete(id)

      // 콜백 실행 시점에 status 재확인: 로그아웃 후 타이머 발화 시 no-op
      const { status: currentStatus, user: currentUser } = useAuthStore.getState()
      if (currentStatus !== 'signedIn' || !currentUser || !latestProject) return
      upsertCloudProject(latestProject, currentUser.id).catch((e) => {
        console.error('[sync] pushProject failed:', e)
      })
    }, PUSH_DEBOUNCE_MS),
  )
}

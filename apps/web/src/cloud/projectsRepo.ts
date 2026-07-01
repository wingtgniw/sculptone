import { serializeProject, type Project } from '@sculptone/score-model'
import { supabase } from './supabase'

/** Supabase `projects` 테이블 행 타입 (클라이언트 반환 형태) */
export interface CloudProjectRow {
  id: string
  owner: string
  title: string
  updated_at: string // ISO 8601 (Supabase가 timestamptz를 ISO string으로 반환)
  data: unknown // jsonb: deserializeProject(JSON.stringify(data)) 로 복원
}

/**
 * 현재 사용자의 모든 클라우드 프로젝트를 가져온다.
 * supabase === null(미설정) → [] 반환(no-op, 정상).
 * 정상 빈 결과 → [] 반환(정상).
 * 쿼리 에러 → console.error + throw (호출자가 빈 클라우드와 불통을 구분해야 함).
 */
export async function fetchCloudProjects(): Promise<CloudProjectRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('projects')
    .select('id, owner, title, updated_at, data')
  if (error) {
    console.error('[projectsRepo] fetchCloudProjects failed:', error)
    throw new Error(error.message)
  }
  return (data ?? []) as CloudProjectRow[]
}

/**
 * 프로젝트를 클라우드에 upsert한다 (insert or update, onConflict: id).
 * supabase === null → no-op.
 * 오류 → console.error + rethrow (호출자가 재시도 여부 결정).
 */
export async function upsertCloudProject(project: Project, ownerId: string): Promise<void> {
  if (!supabase) return
  const data = JSON.parse(serializeProject(project)) as unknown
  const { error } = await supabase.from('projects').upsert(
    {
      id: project.id,
      owner: ownerId,
      title: project.metadata.title,
      data,
      updated_at: project.metadata.updatedAt,
    },
    { onConflict: 'id' },
  )
  if (error) {
    console.error('[projectsRepo] upsertCloudProject failed:', error)
    throw new Error(error.message)
  }
}

/**
 * 클라우드에서 프로젝트를 삭제한다.
 * supabase === null → no-op.
 * 오류 → console.error + rethrow.
 *
 * NOTE: Sub-project B 에서 sync.ts가 이 함수를 호출하지 않는다.
 * 삭제 동기화는 이번 범위 밖. 미래 기능을 위한 예약 구현.
 */
export async function deleteCloudProject(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) {
    console.error('[projectsRepo] deleteCloudProject failed:', error)
    throw new Error(error.message)
  }
}

import { type IDBPDatabase } from 'idb'
import { getDB, type SculptoneDB } from './_db'
import { serializeProject, deserializeProject, type Project } from '@sculptone/score-model'

// storage.test.ts 호환 유지: __resetDB를 이 모듈에서 re-export한다.
// (storage.test.ts는 '../storage'에서 __resetDB를 import하므로 경로 변경 불필요)
export { __resetDB } from './_db'

// 타입 참조용: IDBPDatabase<SculptoneDB> 에서 projects store 접근
type DB = IDBPDatabase<SculptoneDB>
const STORE_NAME = 'projects' as const

/** 프로젝트를 IndexedDB에 저장(upsert). 직렬화는 serializeProject 사용. */
export async function saveProject(project: Project): Promise<void> {
  const db: DB = await getDB()
  // 저장 시각으로 updatedAt을 스탬프 → 레코드와 직렬화 데이터에 동일 값 사용.
  const now = new Date().toISOString()
  const stamped: Project = {
    ...project,
    metadata: { ...project.metadata, updatedAt: now },
  }
  await db.put(STORE_NAME, {
    id: stamped.id,
    title: stamped.metadata.title,
    updatedAt: now,
    data: serializeProject(stamped),
  })
}

/** ID로 프로젝트 로드. 없으면 undefined. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const db: DB = await getDB()
  const record = await db.get(STORE_NAME, id)
  if (!record) return undefined
  return deserializeProject(record.data)
}

/** 저장된 프로젝트 요약 목록 (id · title · updatedAt). */
export interface ProjectSummary {
  id: string
  title: string
  updatedAt: string
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db: DB = await getDB()
  const all = await db.getAll(STORE_NAME)
  return all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 프로젝트 삭제 */
export async function deleteProject(id: string): Promise<void> {
  const db: DB = await getDB()
  await db.delete(STORE_NAME, id)
}

/**
 * Cloud sync 전용: project.metadata.updatedAt을 재발급하지 않고 그대로 보존하여 저장.
 * 클라우드에서 다운로드한 프로젝트를 로컬에 반영할 때 사용한다.
 * 이 함수로 저장한 이후 reconcile 시 타임스탬프가 클라우드와 동일 → 재업로드 방지.
 *
 * 일반 사용자 편집 저장에는 saveProject를 사용할 것 (updatedAt 재발급).
 */
export async function saveProjectRaw(project: Project): Promise<void> {
  const db: DB = await getDB()
  await db.put(STORE_NAME, {
    id: project.id,
    title: project.metadata.title,
    updatedAt: project.metadata.updatedAt, // 재발급 없이 원본 타임스탬프 보존
    data: serializeProject(project), // project.metadata.updatedAt 포함된 채 직렬화
  })
}

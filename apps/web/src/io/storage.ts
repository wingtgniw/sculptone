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
    id:        stamped.id,
    title:     stamped.metadata.title,
    updatedAt: now,
    data:      serializeProject(stamped),
  })
}

/** ID로 프로젝트 로드. 없으면 undefined. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const db: DB  = await getDB()
  const record  = await db.get(STORE_NAME, id)
  if (!record) return undefined
  return deserializeProject(record.data)
}

/** 저장된 프로젝트 요약 목록 (id · title · updatedAt). */
export interface ProjectSummary {
  id:        string
  title:     string
  updatedAt: string
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db: DB = await getDB()
  const all    = await db.getAll(STORE_NAME)
  return all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 프로젝트 삭제 */
export async function deleteProject(id: string): Promise<void> {
  const db: DB = await getDB()
  await db.delete(STORE_NAME, id)
}

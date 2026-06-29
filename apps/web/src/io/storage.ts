import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { serializeProject, deserializeProject, type Project } from '@sculptone/score-model'

/** IndexedDB 스키마 정의 */
interface SculptoneDB extends DBSchema {
  projects: {
    key: string
    value: {
      id:        string
      title:     string
      updatedAt: string
      data:      string   // serializeProject(project) 의 JSON 문자열
    }
  }
}

const DB_NAME    = 'sculptone'
const STORE_NAME = 'projects'
const DB_VERSION = 1

/**
 * DB 연결을 모듈 레벨에서 캐싱한다(매 CRUD마다 새 연결 생성 방지).
 * 연결이 종료되면 캐시를 리셋하고, 테스트 격리는 __resetDB()로 처리한다.
 */
let dbPromise: Promise<IDBPDatabase<SculptoneDB>> | null = null

function getDB(): Promise<IDBPDatabase<SculptoneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SculptoneDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      },
      terminated() {
        dbPromise = null
      },
    })
  }
  return dbPromise
}

/** 테스트 격리용: 캐시된 DB 연결 프라미스를 리셋한다. */
export function __resetDB(): void {
  dbPromise = null
}

/** 프로젝트를 IndexedDB에 저장(upsert). 직렬화는 serializeProject 사용. */
export async function saveProject(project: Project): Promise<void> {
  const db = await getDB()
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
  const db     = await getDB()
  const record = await db.get(STORE_NAME, id)
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
  const db  = await getDB()
  const all = await db.getAll(STORE_NAME)
  return all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 프로젝트 삭제 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}

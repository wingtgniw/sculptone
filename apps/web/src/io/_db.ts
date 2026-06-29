import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * IndexedDB 스키마 정의.
 * v1: projects store
 * v2: patches store 추가
 */
export interface SculptoneDB extends DBSchema {
  projects: {
    key: string
    value: {
      id:        string
      title:     string
      updatedAt: string
      data:      string   // serializeProject(project) JSON 문자열
    }
  }
  patches: {
    key: string
    value: {
      id:        string
      name:      string
      soundJson: string   // JSON.stringify(Sound)
      createdAt: string
    }
  }
}

export const DB_NAME    = 'sculptone'
export const DB_VERSION = 2

/**
 * DB 연결을 모듈 레벨에서 캐싱한다(매 CRUD마다 새 연결 생성 방지).
 * storage.ts와 patch-storage.ts가 이 함수를 공유해 단일 연결만 유지,
 * versionchange 충돌을 방지한다.
 */
let dbPromise: Promise<IDBPDatabase<SculptoneDB>> | null = null

export function getDB(): Promise<IDBPDatabase<SculptoneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SculptoneDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 이전: projects store 생성
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' })
        }
        // v2 이전: patches store 추가
        if (oldVersion < 2) {
          db.createObjectStore('patches', { keyPath: 'id' })
        }
      },
      terminated() {
        // 연결이 강제 종료되면 캐시를 리셋해 다음 getDB() 시 재연결
        dbPromise = null
      },
    }).catch((err) => { dbPromise = null; throw err })
  }
  return dbPromise
}

/**
 * 테스트 격리용: 캐시된 DB 연결 프라미스를 리셋한다.
 * storage.ts가 이를 re-export하므로 storage.test.ts의 import 경로가 변경되지 않는다.
 */
export function __resetDB(): void {
  dbPromise = null
}

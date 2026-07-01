// fake-indexeddb/auto: IDBRequest · IDBDatabase 등 instanceof 검사용 전역 설정
import 'fake-indexeddb/auto'
// 계획서 fallback: 테스트별 새 IDBFactory 인스턴스 → 연결 블록 없이 완전 격리
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, it, expect } from 'vitest'
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  saveProjectRaw,
  __resetDB,
} from '../storage'
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
  type Project,
} from '@sculptone/score-model'

function makeProject(title = 'Test') {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject(title), t), t.id, n)
}

// 각 테스트 전에 캐시된 DB 연결을 리셋하고 새 IDBFactory 인스턴스로 교체 → 완전 격리
// (fake-indexeddb/auto가 설정한 IDBRequest 등의 클래스 참조는 유지됨)
beforeEach(() => {
  __resetDB()
  globalThis.indexedDB = new IDBFactory()
})

describe('storage', () => {
  it('saveProject → loadProject 가 동일한 프로젝트를 복원한다', async () => {
    const p = makeProject('Round Trip')
    await saveProject(p)
    const loaded = await loadProject(p.id)
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe(p.id)
    expect(loaded!.metadata.title).toBe('Round Trip')
    expect(loaded!.tracks[0]!.notes).toHaveLength(1)
    expect(loaded!.tracks[0]!.notes[0]!.pitch).toBe(60)
  })

  it('존재하지 않는 id는 undefined를 반환한다', async () => {
    const result = await loadProject('no-such-id')
    expect(result).toBeUndefined()
  })

  it('listProjects 가 저장된 프로젝트 요약을 반환한다', async () => {
    const p1 = makeProject('Alpha')
    const p2 = makeProject('Beta')
    await saveProject(p1)
    await saveProject(p2)
    const list = await listProjects()
    expect(list).toHaveLength(2)
    const titles = list.map((x) => x.title)
    expect(titles).toContain('Alpha')
    expect(titles).toContain('Beta')
  })

  it('listProjects 결과는 id·title·updatedAt 필드만 포함한다', async () => {
    const p = makeProject('Fields')
    await saveProject(p)
    const list = await listProjects()
    expect(list[0]).toEqual(expect.objectContaining({ id: p.id, title: 'Fields' }))
    // tracks 는 포함되지 않음
    expect((list[0] as unknown as Record<string, unknown>)['tracks']).toBeUndefined()
  })

  it('deleteProject 후 loadProject는 undefined를 반환한다', async () => {
    const p = makeProject('Delete Me')
    await saveProject(p)
    await deleteProject(p.id)
    expect(await loadProject(p.id)).toBeUndefined()
  })

  it('saveProject가 updatedAt을 저장 시각으로 스탬프하고 listProjects가 이를 반환한다', async () => {
    const p = makeProject('Stamp')
    // 의도적으로 과거 시각으로 설정 → 저장 시 현재 시각으로 갱신되어야 한다
    const stale = { ...p, metadata: { ...p.metadata, updatedAt: '2000-01-01T00:00:00.000Z' } }
    await saveProject(stale)
    const list = await listProjects()
    expect(list).toHaveLength(1)
    expect(typeof list[0]!.updatedAt).toBe('string')
    expect(list[0]!.updatedAt).not.toBe('2000-01-01T00:00:00.000Z')
    // 직렬화된 데이터의 updatedAt도 동일하게 갱신되어야 한다
    const loaded = await loadProject(p.id)
    expect(loaded!.metadata.updatedAt).toBe(list[0]!.updatedAt)
  })

  it('saveProject는 같은 id로 덮어쓴다 (upsert)', async () => {
    const p = makeProject('Original')
    await saveProject(p)
    const updated = { ...p, metadata: { ...p.metadata, title: 'Updated' } }
    await saveProject(updated)
    const loaded = await loadProject(p.id)
    expect(loaded!.metadata.title).toBe('Updated')
    const list = await listProjects()
    expect(list).toHaveLength(1) // 중복 저장 없음
  })
})

describe('saveProjectRaw', () => {
  it('project.metadata.updatedAt을 재발급하지 않고 그대로 저장한다', async () => {
    const project = createEmptyProject('Raw Test')
    // 오래된 타임스탬프를 수동 설정
    const oldTimestamp = '2026-01-01T00:00:00.000Z'
    const projectWithOldTs: Project = {
      ...project,
      metadata: { ...project.metadata, updatedAt: oldTimestamp },
    }
    await saveProjectRaw(projectWithOldTs)
    const summaries = await listProjects()
    const saved = summaries.find((s) => s.id === project.id)
    expect(saved).toBeDefined()
    // 재발급 없이 원래 타임스탬프가 보존되어야 함
    expect(saved!.updatedAt).toBe(oldTimestamp)
  })

  it('saveProjectRaw로 저장한 프로젝트를 loadProject로 복원하면 원본과 일치한다', async () => {
    const project = createEmptyProject('Load Raw Test')
    const ts = '2025-12-31T23:59:59.999Z'
    const stamped: Project = { ...project, metadata: { ...project.metadata, updatedAt: ts } }
    await saveProjectRaw(stamped)
    const loaded = await loadProject(stamped.id)
    expect(loaded).toBeDefined()
    expect(loaded!.metadata.updatedAt).toBe(ts)
  })
})

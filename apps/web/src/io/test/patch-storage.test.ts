// fake-indexeddb/auto: IDBRequest · IDBDatabase 등 instanceof 검사용 전역 설정
import 'fake-indexeddb/auto'
// 테스트별 새 IDBFactory 인스턴스 → 연결 블록 없이 완전 격리
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { savePatch, listPatches, loadPatch, deletePatch } from '../patch-storage'
import { getDB } from '../_db'
// __resetDB는 storage.ts에서 re-export하므로 기존 storage.test.ts와 동일 경로
import { saveProject, loadProject, __resetDB } from '../storage'
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
} from '@sculptone/score-model'
import type { Sound } from '@sculptone/score-model'

// ── 픽스처 ─────────────────────────────────────────────────────

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

const FULL_PATCH: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
  filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
  effects: [
    { type: 'reverb', wet: 0.3, decay: 2.5 },
    { type: 'delay', wet: 0.2, time: 0.25, feedback: 0.4 },
  ],
}

const PRESET_SOUND: Sound = { kind: 'preset', presetId: 'acoustic-piano' }

function makeProject(title = 'Test') {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject(title), t), t.id, n)
}

// 각 테스트 전에 캐시된 DB 연결을 리셋하고 새 IDBFactory 인스턴스로 교체 → 완전 격리
beforeEach(() => {
  __resetDB()
  globalThis.indexedDB = new IDBFactory()
})

// ── patch-storage 단위 테스트 ───────────────────────────────────

describe('patch-storage', () => {
  it('savePatch → loadPatch가 동일한 Sound를 복원한다(BASE_PATCH)', async () => {
    const saved = await savePatch('My Lead', BASE_PATCH)
    expect(saved.id).toBeTruthy()
    expect(saved.name).toBe('My Lead')
    const loaded = await loadPatch(saved.id)
    expect(loaded).toBeDefined()
    expect(loaded).toEqual(BASE_PATCH)
  })

  it('filter + effects 포함 FULL_PATCH도 무손실 복원된다', async () => {
    const saved = await savePatch('Full Patch', FULL_PATCH)
    const loaded = await loadPatch(saved.id)
    expect(loaded).toEqual(FULL_PATCH)
  })

  it('preset sound도 저장·복원된다', async () => {
    const saved = await savePatch('Piano Preset', PRESET_SOUND)
    const loaded = await loadPatch(saved.id)
    expect(loaded).toEqual(PRESET_SOUND)
  })

  it('존재하지 않는 id는 undefined를 반환한다', async () => {
    const result = await loadPatch('no-such-id')
    expect(result).toBeUndefined()
  })

  it('listPatches가 저장된 요약 목록을 반환한다(name 포함)', async () => {
    await savePatch('Patch A', BASE_PATCH)
    await savePatch('Patch B', { ...BASE_PATCH, engine: 'fm' as const })
    const list = await listPatches()
    expect(list).toHaveLength(2)
    const names = list.map((p) => p.name)
    expect(names).toContain('Patch A')
    expect(names).toContain('Patch B')
  })

  it('listPatches 결과에는 soundJson이 포함되지 않는다', async () => {
    await savePatch('Test', BASE_PATCH)
    const list = await listPatches()
    expect(list[0]).toHaveProperty('id')
    expect(list[0]).toHaveProperty('name', 'Test')
    expect(list[0]).toHaveProperty('createdAt')
    expect((list[0] as unknown as Record<string, unknown>)['soundJson']).toBeUndefined()
  })

  it('deletePatch 후 loadPatch는 undefined를 반환한다', async () => {
    const saved = await savePatch('To Delete', BASE_PATCH)
    await deletePatch(saved.id)
    expect(await loadPatch(saved.id)).toBeUndefined()
  })

  it('빈 name으로 savePatch 시 Error를 throw한다', async () => {
    await expect(savePatch('', BASE_PATCH)).rejects.toThrow()
    await expect(savePatch('   ', BASE_PATCH)).rejects.toThrow()
  })

  // ── 손상 레코드 검증 ────────────────────────────────────────────

  it('손상 레코드(스키마 위반) → ZodError를 throw한다', async () => {
    const db = await getDB()
    await db.put('patches', {
      id: 'corrupt-1',
      name: 'C',
      soundJson: '{"kind":"patch"}', // engine / envelope 누락 → SoundSchema 실패
      createdAt: new Date().toISOString(),
    })
    await expect(loadPatch('corrupt-1')).rejects.toThrow(ZodError)
  })

  it('손상 레코드(비-JSON) → Error를 throw한다', async () => {
    const db = await getDB()
    await db.put('patches', {
      id: 'corrupt-2',
      name: 'C',
      soundJson: 'not-json',
      createdAt: new Date().toISOString(),
    })
    await expect(loadPatch('corrupt-2')).rejects.toThrow()
  })

  // ── listPatches 정렬 검증 ────────────────────────────────────────

  it('listPatches는 createdAt 오름차순으로 정렬한다', async () => {
    const db = await getDB()
    // 의도적으로 역순(나중 것 먼저) put
    await db.put('patches', {
      id: 'p-late',
      name: 'Newer',
      soundJson: JSON.stringify(BASE_PATCH),
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    await db.put('patches', {
      id: 'p-early',
      name: 'Older',
      soundJson: JSON.stringify(BASE_PATCH),
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const list = await listPatches()
    expect(list.map((p) => p.name)).toEqual(['Older', 'Newer'])
  })

  // ── 공존 검증: projects store와 patches store가 같은 DB에서 독립 동작 ──

  it('[공존] saveProject와 savePatch가 같은 DB에서 독립적으로 동작한다', async () => {
    const project = makeProject('Co-exist Project')
    await saveProject(project)
    await savePatch('Co-exist Patch', BASE_PATCH)

    // projects store 정상
    const loadedProject = await loadProject(project.id)
    expect(loadedProject).toBeDefined()
    expect(loadedProject!.metadata.title).toBe('Co-exist Project')
    expect(loadedProject!.tracks[0]!.notes[0]!.pitch).toBe(60)

    // patches store 정상
    const patches = await listPatches()
    expect(patches).toHaveLength(1)
    expect(patches[0]!.name).toBe('Co-exist Patch')
  })
})

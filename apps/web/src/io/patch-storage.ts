import { getDB } from './_db'
import { SoundSchema, type Sound } from '@sculptone/score-model'

const STORE_NAME = 'patches' as const

/** patches store 레코드 전체 (soundJson 포함) */
export interface SavedPatch {
  id: string
  name: string
  soundJson: string // JSON.stringify(Sound)
  createdAt: string // ISO 8601
}

/** listPatches() 반환 타입 (soundJson 제외 — 목록 표시용) */
export interface PatchSummary {
  id: string
  name: string
  createdAt: string
}

/**
 * 커스텀 패치를 이름 붙여 IndexedDB에 저장한다.
 * id는 자동 생성(crypto.randomUUID).
 * @throws {Error} name이 빈 문자열(또는 공백만)일 때
 */
export async function savePatch(name: string, sound: Sound): Promise<SavedPatch> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Patch name must not be empty')

  const db = await getDB()
  const record: SavedPatch = {
    id: crypto.randomUUID(),
    name: trimmed,
    soundJson: JSON.stringify(sound),
    createdAt: new Date().toISOString(),
  }
  await db.put(STORE_NAME, record)
  return record
}

/**
 * 저장된 패치 요약 목록을 반환한다 (soundJson 제외).
 * createdAt 오름차순으로 정렬한다(먼저 저장된 항목이 상단).
 */
export async function listPatches(): Promise<PatchSummary[]> {
  const db = await getDB()
  const all = await db.getAll(STORE_NAME)
  return all
    .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * id로 패치의 Sound 객체를 로드한다. 없으면 undefined.
 * soundJson을 SoundSchema.parse로 검증해 타입 안전성을 보장한다.
 * @throws {ZodError} 레코드가 손상되어 SoundSchema를 통과하지 못할 때
 */
export async function loadPatch(id: string): Promise<Sound | undefined> {
  const db = await getDB()
  const record = await db.get(STORE_NAME, id)
  if (!record) return undefined
  // Zod 검증: 저장 시점 이후 스키마 변경이 있더라도 안전하게 파싱
  return SoundSchema.parse(JSON.parse(record.soundJson))
}

/** 패치 삭제 */
export async function deletePatch(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}

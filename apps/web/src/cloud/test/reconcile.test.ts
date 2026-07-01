import { describe, it, expect } from 'vitest'
// reconcile은 순수 함수 — mock 없음
import { reconcile } from '../reconcile'
import type { ProjectMeta } from '../reconcile'

// 테스트용 타임스탬프 헬퍼
const T1 = '2026-01-01T00:00:00.000Z' // 가장 오래됨
const T2 = '2026-06-01T00:00:00.000Z' // 중간
const T3 = '2026-07-01T12:00:00.000Z' // 가장 최신

describe('reconcile — LWW 동기화 결정', () => {
  // ── 빈 목록 ──────────────────────────────────────────────────

  it('local 빈 배열 + cloud 빈 배열 → toUpload=[], toDownload=[]', () => {
    expect(reconcile([], [])).toEqual({ toUpload: [], toDownload: [] })
  })

  // ── 단방향: 한쪽에만 존재 ────────────────────────────────────

  it('local에만 있는 프로젝트 → toUpload에 포함', () => {
    const local: ProjectMeta[] = [{ id: 'p1', updatedAt: T2 }]
    const result = reconcile(local, [])
    expect(result.toUpload).toContain('p1')
    expect(result.toDownload).toHaveLength(0)
  })

  it('cloud에만 있는 프로젝트 → toDownload에 포함', () => {
    const cloud: ProjectMeta[] = [{ id: 'p2', updatedAt: T2 }]
    const result = reconcile([], cloud)
    expect(result.toDownload).toContain('p2')
    expect(result.toUpload).toHaveLength(0)
  })

  // ── 양쪽 존재: LWW 비교 ──────────────────────────────────────

  it('양쪽 있음 + 로컬이 더 최신 → toUpload', () => {
    const local: ProjectMeta[] = [{ id: 'p3', updatedAt: T3 }]
    const cloud: ProjectMeta[] = [{ id: 'p3', updatedAt: T2 }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).toContain('p3')
    expect(result.toDownload).not.toContain('p3')
  })

  it('양쪽 있음 + 클라우드가 더 최신 → toDownload', () => {
    const local: ProjectMeta[] = [{ id: 'p4', updatedAt: T1 }]
    const cloud: ProjectMeta[] = [{ id: 'p4', updatedAt: T3 }]
    const result = reconcile(local, cloud)
    expect(result.toDownload).toContain('p4')
    expect(result.toUpload).not.toContain('p4')
  })

  it('양쪽 있음 + 동일 타임스탬프(tie) → 아무것도 없음', () => {
    const local: ProjectMeta[] = [{ id: 'p5', updatedAt: T2 }]
    const cloud: ProjectMeta[] = [{ id: 'p5', updatedAt: T2 }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).not.toContain('p5')
    expect(result.toDownload).not.toContain('p5')
  })

  // ── 단방향: 한쪽이 여러 개 ───────────────────────────────────

  it('로컬 없음 + 클라우드 여러 개 → 전부 toDownload', () => {
    const cloud: ProjectMeta[] = [
      { id: 'a', updatedAt: T1 },
      { id: 'b', updatedAt: T2 },
      { id: 'c', updatedAt: T3 },
    ]
    const result = reconcile([], cloud)
    expect(result.toDownload).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(result.toDownload).toHaveLength(3)
    expect(result.toUpload).toHaveLength(0)
  })

  it('로컬 여러 개 + 클라우드 없음 → 전부 toUpload', () => {
    const local: ProjectMeta[] = [
      { id: 'x', updatedAt: T1 },
      { id: 'y', updatedAt: T3 },
    ]
    const result = reconcile(local, [])
    expect(result.toUpload).toEqual(expect.arrayContaining(['x', 'y']))
    expect(result.toUpload).toHaveLength(2)
    expect(result.toDownload).toHaveLength(0)
  })

  // ── 혼합: 6가지 케이스 동시 ──────────────────────────────────

  it('혼합 시나리오: 로컬전용·클라우드전용·로컬최신·클라우드최신·tie → 각각 올바른 분류', () => {
    const local: ProjectMeta[] = [
      { id: 'local-only', updatedAt: T2 }, // → toUpload
      { id: 'local-newer', updatedAt: T3 }, // → toUpload
      { id: 'cloud-newer', updatedAt: T1 }, // → toDownload
      { id: 'tie', updatedAt: T2 }, // → 없음
    ]
    const cloud: ProjectMeta[] = [
      { id: 'cloud-only', updatedAt: T2 }, // → toDownload
      { id: 'local-newer', updatedAt: T2 }, // → toUpload (로컬 T3 > 클라우드 T2)
      { id: 'cloud-newer', updatedAt: T3 }, // → toDownload (클라우드 T3 > 로컬 T1)
      { id: 'tie', updatedAt: T2 }, // → 없음
    ]
    const result = reconcile(local, cloud)

    expect(result.toUpload).toEqual(expect.arrayContaining(['local-only', 'local-newer']))
    expect(result.toUpload).not.toContain('cloud-only')
    expect(result.toUpload).not.toContain('cloud-newer')
    expect(result.toUpload).not.toContain('tie')

    expect(result.toDownload).toEqual(expect.arrayContaining(['cloud-only', 'cloud-newer']))
    expect(result.toDownload).not.toContain('local-only')
    expect(result.toDownload).not.toContain('local-newer')
    expect(result.toDownload).not.toContain('tie')
  })

  // ── 입력 배열 불변성 ────────────────────────────────────────

  it('입력 배열을 변경하지 않는다(순수 함수)', () => {
    const local: ProjectMeta[] = [{ id: 'p', updatedAt: T1 }]
    const cloud: ProjectMeta[] = [{ id: 'q', updatedAt: T2 }]
    const localCopy = [...local]
    const cloudCopy = [...cloud]
    reconcile(local, cloud)
    expect(local).toEqual(localCopy)
    expect(cloud).toEqual(cloudCopy)
  })

  // ── epoch 비교 / 포맷 불일치 방어 (Fix A 회귀) ──────────────

  it('동일 순간, 포맷만 다름(Z vs +00:00) → tie (toUpload/toDownload 모두 비어야 함)', () => {
    // 로컬: new Date().toISOString() → ...000Z
    // 클라우드: Postgres timestamptz via PostgREST → ...+00:00
    const localAt = '2026-07-01T12:00:00.000Z'
    const cloudAt = '2026-07-01T12:00:00+00:00'
    const local: ProjectMeta[] = [{ id: 'p', updatedAt: localAt }]
    const cloud: ProjectMeta[] = [{ id: 'p', updatedAt: cloudAt }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).toHaveLength(0)
    expect(result.toDownload).toHaveLength(0)
  })

  it('포맷 혼합, 로컬이 1초 최신(Z) vs 클라우드(+00:00) → toUpload', () => {
    const local: ProjectMeta[] = [{ id: 'p', updatedAt: '2026-07-01T12:00:01.000Z' }]
    const cloud: ProjectMeta[] = [{ id: 'p', updatedAt: '2026-07-01T12:00:00+00:00' }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).toContain('p')
    expect(result.toDownload).not.toContain('p')
  })

  it('포맷 혼합, 클라우드가 1초 최신(+00:00) vs 로컬(Z) → toDownload', () => {
    const local: ProjectMeta[] = [{ id: 'p', updatedAt: '2026-07-01T12:00:00.000Z' }]
    const cloud: ProjectMeta[] = [{ id: 'p', updatedAt: '2026-07-01T12:00:01+00:00' }]
    const result = reconcile(local, cloud)
    expect(result.toDownload).toContain('p')
    expect(result.toUpload).not.toContain('p')
  })
})

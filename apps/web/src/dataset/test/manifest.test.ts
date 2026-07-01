import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// 순수 함수 — mock 없음 (Date는 vi.setSystemTime으로 제어)
import { buildManifest } from '../manifest'
import { createEmptyProject } from '@sculptone/score-model'

const FIXED_DATE = '2026-07-01T12:00:00.000Z'

describe('buildManifest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_DATE))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('schemaVersion이 "1.0.0"이다', () => {
    const p = createEmptyProject('Test')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 5.0, noteCount: 10 })
    expect(m.schemaVersion).toBe('1.0.0')
  })

  it('projectId / title이 프로젝트 메타에서 온다', () => {
    const p = createEmptyProject('My Song')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 3.0, noteCount: 5 })
    expect(m.projectId).toBe(p.id)
    expect(m.title).toBe('My Song')
  })

  it('transport 필드(tempo/ppq/timeSignature)가 정확히 반영된다', () => {
    const p = createEmptyProject('T')
    // 기본값: tempo=120, ppq=480, timeSignature=[4,4]
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 2.0, noteCount: 0 })
    expect(m.tempo).toBe(120)
    expect(m.ppq).toBe(480)
    expect(m.timeSignature).toEqual([4, 4])
  })

  it('opts 값(sampleRate/durationSec/noteCount)이 그대로 포함된다', () => {
    const p = createEmptyProject('T')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 7.5, noteCount: 42 })
    expect(m.sampleRate).toBe(44100)
    expect(m.durationSec).toBeCloseTo(7.5)
    expect(m.noteCount).toBe(42)
  })

  it('channels=2, bitDepth=16 (하드코딩 상수)', () => {
    const p = createEmptyProject('T')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 1.0, noteCount: 0 })
    expect(m.channels).toBe(2)
    expect(m.bitDepth).toBe(16)
  })

  it('exportedAt이 현재 시각의 ISO 8601 문자열이다', () => {
    const p = createEmptyProject('T')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 1.0, noteCount: 0 })
    expect(m.exportedAt).toBe(FIXED_DATE)
  })

  it('files 배열이 4개 항목을 올바른 이름으로 포함한다', () => {
    const p = createEmptyProject('T')
    const m = buildManifest(p, { sampleRate: 44100, durationSec: 1.0, noteCount: 0 })
    expect(m.files).toEqual(['audio.wav', 'notes.json', 'notes.mid', 'manifest.json'])
  })
})

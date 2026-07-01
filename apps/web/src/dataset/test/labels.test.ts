import { describe, it, expect } from 'vitest'
// 순수 함수 — mock 없음
import { buildNoteLabels } from '../labels'
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
} from '@sculptone/score-model'

// 헬퍼: 기본 프로젝트 (120BPM, ppq=480)
function mkProject() {
  return createEmptyProject('Test')
}

describe('buildNoteLabels', () => {
  // ── 빈 프로젝트 ──────────────────────────────────────────────

  it('노트 없는 프로젝트 → 빈 배열 반환', () => {
    const track = createTrack('Piano')
    const p = addTrack(mkProject(), track)
    expect(buildNoteLabels(p)).toEqual([])
  })

  // ── onset / offset 계산 ──────────────────────────────────────

  it('단일 노트: onset_s / offset_s 정확히 계산 (120BPM ppq480)', () => {
    // 120BPM, ppq=480: 1tick = 1/480 beat = 1/960 sec (0.5 sec/beat)
    // start=480ticks = 0.5sec, duration=480ticks = 0.5sec → offset=1.0sec
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const labels = buildNoteLabels(p)
    expect(labels).toHaveLength(1)
    expect(labels[0]!.onset_s).toBeCloseTo(0.5)
    expect(labels[0]!.offset_s).toBeCloseTo(1.0)
  })

  // ── pitch / velocity 필드 ────────────────────────────────────

  it('pitch 필드가 MIDI 번호를 그대로 반환', () => {
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    p = addNote(p, track.id, createNote({ pitch: 69, start: 0, duration: 480, velocity: 100 }))
    const labels = buildNoteLabels(p)
    expect(labels[0]!.pitch).toBe(69)
  })

  it('velocity가 0~1 정규화 float (buildMultiSchedule과 동일: n.velocity/127)', () => {
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 127 }))
    p = addNote(p, track.id, createNote({ pitch: 62, start: 480, duration: 480, velocity: 64 }))
    const labels = buildNoteLabels(p)
    expect(labels[0]!.velocity).toBeCloseTo(127 / 127) // 1.0
    expect(labels[1]!.velocity).toBeCloseTo(64 / 127)
  })

  // ── track 필드 ──────────────────────────────────────────────

  it('track 필드가 trackId를 포함', () => {
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 64 }))
    const labels = buildNoteLabels(p)
    expect(labels[0]!.track).toBe(track.id)
  })

  // ── 정렬 ────────────────────────────────────────────────────

  it('노트 여러 개: onset_s 오름차순 정렬', () => {
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    // 역순으로 추가
    p = addNote(p, track.id, createNote({ pitch: 64, start: 960, duration: 240, velocity: 80 }))
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, track.id, createNote({ pitch: 67, start: 480, duration: 480, velocity: 64 }))
    const labels = buildNoteLabels(p)
    expect(labels[0]!.onset_s).toBeLessThanOrEqual(labels[1]!.onset_s)
    expect(labels[1]!.onset_s).toBeLessThanOrEqual(labels[2]!.onset_s)
  })

  it('onset 동점 시 pitch 오름차순 정렬', () => {
    const track = createTrack('Piano')
    let p = addTrack(mkProject(), track)
    p = addNote(p, track.id, createNote({ pitch: 67, start: 0, duration: 240, velocity: 64 }))
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 240, velocity: 64 }))
    const labels = buildNoteLabels(p)
    expect(labels[0]!.pitch).toBe(60)
    expect(labels[1]!.pitch).toBe(67)
  })

  // ── 멀티트랙 ────────────────────────────────────────────────

  it('멀티트랙: 두 트랙의 노트를 통합해 반환', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(mkProject(), t1)
    p = addTrack(p, t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, t2.id, createNote({ pitch: 36, start: 480, duration: 480, velocity: 80 }))
    const labels = buildNoteLabels(p)
    expect(labels).toHaveLength(2)
    const tracks = labels.map((l) => l.track)
    expect(tracks).toContain(t1.id)
    expect(tracks).toContain(t2.id)
  })

  it('muted 트랙의 노트는 포함하지 않음 (audibleTrackIds 준수)', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Muted')
    let p = addTrack(mkProject(), t1)
    p = addTrack(p, t2)
    // t2를 muted로 설정
    p = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === t2.id ? { ...t, mixer: { ...t.mixer, muted: true } } : t,
      ),
    }
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, t2.id, createNote({ pitch: 48, start: 0, duration: 480, velocity: 80 }))
    const labels = buildNoteLabels(p)
    // t1 노트만 포함
    expect(labels).toHaveLength(1)
    expect(labels[0]!.track).toBe(t1.id)
  })
})

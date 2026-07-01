import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unzipSync } from 'fflate'
import { createEmptyProject, createTrack, addTrack } from '@sculptone/score-model'

// ── 페이크 AudioBuffer (호이스팅 불필요 — vi.mock factory에서 직접 참조 안 함) ──
const fakeAudioBuffer = {
  numberOfChannels: 2,
  length: 100,
  sampleRate: 44100,
  duration: 100 / 44100,
  getChannelData: () => new Float32Array(100),
}

// ── 호이스팅된 mock 변수 (vi.mock factory에서 참조) ─────────────────────────
const {
  mockRenderProjectAudio,
  mockEncodeWav,
  mockBuildNoteLabels,
  mockBuildManifest,
  mockProjectToMidi,
  mockDownloadBytes,
} = vi.hoisted(() => {
  const mockRenderProjectAudio = vi.fn()
  const mockEncodeWav = vi.fn(() => new Uint8Array([0x52, 0x49, 0x46, 0x46])) // 'RIFF' 스텁
  const mockBuildNoteLabels = vi.fn(() => [
    { onset_s: 0, offset_s: 0.5, pitch: 60, velocity: 0.8, track: 'track-1' },
  ])
  const mockBuildManifest = vi.fn(() => ({
    schemaVersion: '1.0.0',
    projectId: 'p1',
    title: 'Test',
    tempo: 120,
    ppq: 480,
    timeSignature: [4, 4] as [number, number],
    sampleRate: 44100,
    channels: 2,
    bitDepth: 16,
    durationSec: 2.0,
    noteCount: 1,
    exportedAt: '2026-07-01T00:00:00.000Z',
    files: ['audio.wav', 'notes.json', 'notes.mid', 'manifest.json'],
  }))
  const mockProjectToMidi = vi.fn(() => new Uint8Array([0x4d, 0x54, 0x68, 0x64])) // 'MThd' 스텁
  const mockDownloadBytes = vi.fn()

  return {
    mockRenderProjectAudio,
    mockEncodeWav,
    mockBuildNoteLabels,
    mockBuildManifest,
    mockProjectToMidi,
    mockDownloadBytes,
  }
})

vi.mock('../renderAudio', () => ({ renderProjectAudio: mockRenderProjectAudio }))
vi.mock('../wav', () => ({ encodeWav: mockEncodeWav }))
vi.mock('../labels', () => ({ buildNoteLabels: mockBuildNoteLabels }))
vi.mock('../manifest', () => ({ buildManifest: mockBuildManifest }))
vi.mock('../../io/files', () => ({ downloadBytes: mockDownloadBytes }))
vi.mock('@sculptone/score-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sculptone/score-model')>()
  return {
    ...actual,
    projectToMidi: mockProjectToMidi,
  }
})

import { buildDatasetZip, downloadDataset } from '../bundle'

// ── Fix B/D용: 경로 mock 확인을 위해 실제 score-model 경로 확인 ──
// vi.mock('../io/files') 에 의해 downloadBytes는 mockDownloadBytes로 대체됨

describe('buildDatasetZip', () => {
  it('4개 파일(audio.wav, notes.json, notes.mid, manifest.json)이 ZIP에 포함된다', () => {
    const wav = new Uint8Array([1, 2, 3, 4])
    const notesJson = new TextEncoder().encode('[]')
    const midi = new Uint8Array([5, 6, 7, 8])
    const manifest = new TextEncoder().encode('{}')

    const zip = buildDatasetZip({ wav, notesJson, midi, manifest })

    // fflate.unzipSync로 라운드트립 검증
    const unzipped = unzipSync(zip)
    expect(Object.keys(unzipped)).toContain('audio.wav')
    expect(Object.keys(unzipped)).toContain('notes.json')
    expect(Object.keys(unzipped)).toContain('notes.mid')
    expect(Object.keys(unzipped)).toContain('manifest.json')
  })

  it('각 파일 내용이 압축 해제 후 원본과 일치한다', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46])
    const notesJson = new TextEncoder().encode('[{"onset_s":0}]')
    const midi = new Uint8Array([0x4d, 0x54, 0x68, 0x64])
    const manifest = new TextEncoder().encode('{"schemaVersion":"1.0.0"}')

    const zip = buildDatasetZip({ wav, notesJson, midi, manifest })
    const unzipped = unzipSync(zip)

    expect(unzipped['audio.wav']).toEqual(wav)
    expect(new TextDecoder().decode(unzipped['notes.json'])).toBe('[{"onset_s":0}]')
  })

  it('결과가 Uint8Array이다', () => {
    const zip = buildDatasetZip({
      wav: new Uint8Array([1]),
      notesJson: new Uint8Array([2]),
      midi: new Uint8Array([3]),
      manifest: new Uint8Array([4]),
    })
    expect(zip).toBeInstanceOf(Uint8Array)
    expect(zip.length).toBeGreaterThan(0)
  })
})

describe('downloadDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadBytes.mockImplementation(() => {})
    mockRenderProjectAudio.mockResolvedValue(fakeAudioBuffer)
    mockEncodeWav.mockReturnValue(new Uint8Array([0x52, 0x49, 0x46, 0x46]))
    mockBuildNoteLabels.mockReturnValue([
      { onset_s: 0, offset_s: 0.5, pitch: 60, velocity: 0.8, track: 'track-1' },
    ])
    mockBuildManifest.mockReturnValue({
      schemaVersion: '1.0.0',
      projectId: 'p1',
      title: 'Test',
      tempo: 120,
      ppq: 480,
      timeSignature: [4, 4] as [number, number],
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      durationSec: 2.0,
      noteCount: 1,
      exportedAt: '2026-07-01T00:00:00.000Z',
      files: ['audio.wav', 'notes.json', 'notes.mid', 'manifest.json'],
    })
    mockProjectToMidi.mockReturnValue(new Uint8Array([0x4d, 0x54, 0x68, 0x64]))
  })

  it('renderProjectAudio가 44100 sampleRate로 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockRenderProjectAudio).toHaveBeenCalledWith(p, { sampleRate: 44100 })
  })

  it('encodeWav가 AudioBuffer + 44100 sampleRate로 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockEncodeWav).toHaveBeenCalledWith(fakeAudioBuffer, 44100)
  })

  it('buildNoteLabels가 프로젝트와 함께 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockBuildNoteLabels).toHaveBeenCalledWith(p)
  })

  it('projectToMidi가 가청 트랙만 포함한 프로젝트와 함께 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    // 빈 프로젝트: tracks=[] → 가청 트랙도 [] → 동일 콘텐츠
    expect(mockProjectToMidi).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: p.metadata, transport: p.transport }),
    )
  })

  it('buildManifest가 sampleRate/durationSec/noteCount를 받아 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockBuildManifest).toHaveBeenCalledWith(
      p,
      expect.objectContaining({
        sampleRate: 44100,
        noteCount: expect.any(Number),
        durationSec: expect.any(Number),
      }),
    )
  })

  it('downloadBytes가 ZIP Uint8Array, 파일명, mime 타입으로 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockDownloadBytes).toHaveBeenCalledOnce()
    const [bytes, , mime] = mockDownloadBytes.mock.calls[0]!
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(mime).toBe('application/zip')
  })

  it('ZIP 파일명이 프로젝트 제목을 sanitize해서 포함한다', async () => {
    const p = createEmptyProject('My Epic Song')
    await downloadDataset(p)
    const [, filename] = mockDownloadBytes.mock.calls[0]! as [Uint8Array, string, string]
    expect(filename).toContain('My_Epic_Song')
    expect(filename).toMatch(/_dataset\.zip$/)
  })

  // Fix B: mute/solo 상태에서 MIDI도 가청 트랙만 포함하는지 검증
  it('muted 트랙은 projectToMidi 인자에서 제외된다', async () => {
    const trackA = createTrack('Audible')
    const trackB = {
      ...createTrack('Muted'),
      mixer: { volume: 0.8, pan: 0, muted: true, soloed: false },
    }
    let project = addTrack(createEmptyProject('MuteTest'), trackA)
    project = addTrack(project, trackB)

    await downloadDataset(project)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calledWithProject = (mockProjectToMidi.mock.calls[0] as unknown as any[])[0] as {
      tracks: { id: string }[]
    }
    const calledTrackIds = calledWithProject.tracks.map((t) => t.id)
    expect(calledTrackIds).toContain(trackA.id)
    expect(calledTrackIds).not.toContain(trackB.id)
  })

  it('soloed 트랙만 projectToMidi에 전달된다', async () => {
    const trackA = createTrack('Normal')
    const trackB = {
      ...createTrack('Soloed'),
      mixer: { volume: 0.8, pan: 0, muted: false, soloed: true },
    }
    let project = addTrack(createEmptyProject('SoloTest'), trackA)
    project = addTrack(project, trackB)

    await downloadDataset(project)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calledWithProject = (mockProjectToMidi.mock.calls[0] as unknown as any[])[0] as {
      tracks: { id: string }[]
    }
    const calledTrackIds = calledWithProject.tracks.map((t) => t.id)
    expect(calledTrackIds).toContain(trackB.id)
    expect(calledTrackIds).not.toContain(trackA.id)
  })

  // Fix D: 비ASCII 제목이 all-underscore 파일명으로 되지 않는지 검증
  it('한글 제목은 all-underscore 대신 폴백 이름을 사용한다', async () => {
    const p = createEmptyProject('한글제목')
    await downloadDataset(p)
    const [, filename] = mockDownloadBytes.mock.calls[0]! as [Uint8Array, string, string]
    // '____' 형태의 all-underscore이면 안 됨
    expect(filename).not.toMatch(/^_+_dataset\.zip$/)
    expect(filename).toMatch(/_dataset\.zip$/)
  })

  it('빈 제목은 폴백 이름을 사용한다', async () => {
    const p = createEmptyProject('')
    await downloadDataset(p)
    const [, filename] = mockDownloadBytes.mock.calls[0]! as [Uint8Array, string, string]
    expect(filename).not.toMatch(/^_dataset\.zip$/)
    expect(filename).toMatch(/_dataset\.zip$/)
  })
})

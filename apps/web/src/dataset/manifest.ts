import type { Project } from '@sculptone/score-model'

/**
 * 데이터셋 ZIP의 manifest.json 내용.
 * ML 학습 파이프라인이 파일 구조·오디오 포맷·라벨 수를 파악할 수 있도록 한다.
 */
export interface Manifest {
  schemaVersion: string
  projectId: string
  title: string
  tempo: number
  ppq: number
  timeSignature: [number, number]
  sampleRate: number
  channels: number
  bitDepth: number
  durationSec: number
  noteCount: number
  exportedAt: string // ISO 8601
  files: string[]
}

/**
 * 프로젝트 메타 + 렌더 정보로 Manifest를 생성한다.
 *
 * opts.durationSec: 실제 렌더 오디오 길이 (content + tail).
 * opts.noteCount: buildNoteLabels의 결과 배열 길이.
 * 순수 함수 (Date.now()는 vi.setSystemTime으로 테스트).
 */
export function buildManifest(
  project: Project,
  opts: { sampleRate: number; durationSec: number; noteCount: number },
): Manifest {
  return {
    schemaVersion: '1.0.0',
    projectId: project.id,
    title: project.metadata.title,
    tempo: project.transport.tempo,
    ppq: project.transport.ppq,
    timeSignature: [project.transport.timeSignature[0], project.transport.timeSignature[1]],
    sampleRate: opts.sampleRate,
    channels: 2,
    bitDepth: 16,
    durationSec: opts.durationSec,
    noteCount: opts.noteCount,
    exportedAt: new Date().toISOString(),
    files: ['audio.wav', 'notes.json', 'notes.mid', 'manifest.json'],
  }
}

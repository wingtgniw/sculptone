import { zipSync } from 'fflate'
import { projectToMidi } from '@sculptone/score-model'
import type { Project } from '@sculptone/score-model'
import { downloadBytes } from '../io/files'
import { audibleTrackIds } from '../audio/multitrack'
import { renderProjectAudio } from './renderAudio'
import { encodeWav } from './wav'
import { buildNoteLabels } from './labels'
import { buildManifest } from './manifest'

const SAMPLE_RATE = 44100

/**
 * 4개 파일을 fflate.zipSync로 묶어 Uint8Array ZIP을 반환한다.
 * 순수(ish) — fflate는 wasm 없는 순수 JS.
 */
export function buildDatasetZip(files: {
  wav: Uint8Array
  notesJson: Uint8Array
  midi: Uint8Array
  manifest: Uint8Array
}): Uint8Array {
  return zipSync({
    'audio.wav': files.wav,
    'notes.json': files.notesJson,
    'notes.mid': files.midi,
    'manifest.json': files.manifest,
  })
}

/**
 * 프로젝트를 학습용 데이터셋 ZIP으로 렌더해 Blob 다운로드한다.
 *
 * 흐름:
 * 1. renderProjectAudio → AudioBuffer
 * 2. encodeWav → WAV Uint8Array
 * 3. buildNoteLabels → NoteLabel[]  → JSON → Uint8Array
 * 4. projectToMidi → MIDI Uint8Array
 * 5. buildManifest → Manifest → JSON → Uint8Array
 * 6. buildDatasetZip → ZIP Uint8Array
 * 7. downloadBytes (Blob 다운로드)
 */
export async function downloadDataset(project: Project): Promise<void> {
  const enc = new TextEncoder()

  // 1. 오디오 렌더
  const audioBuffer = await renderProjectAudio(project, { sampleRate: SAMPLE_RATE })

  // 2. WAV 인코딩
  const wav = encodeWav(audioBuffer, SAMPLE_RATE)

  // 3. 라벨 (JSON)
  const labels = buildNoteLabels(project)
  const notesJson = enc.encode(JSON.stringify(labels, null, 2))

  // 4. MIDI — Fix B: 가청 트랙만 포함해 audio/notes.json과 노트 집합을 일치시킴
  const audibleIds = audibleTrackIds(project)
  const audibleProject = {
    ...project,
    tracks: project.tracks.filter((t) => audibleIds.includes(t.id)),
  }
  const midi = projectToMidi(audibleProject)

  // 5. Manifest (JSON)
  const manifest = buildManifest(project, {
    sampleRate: SAMPLE_RATE,
    durationSec: audioBuffer.duration,
    noteCount: labels.length,
  })
  const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2))

  // 6. ZIP
  const zip = buildDatasetZip({ wav, notesJson, midi, manifest: manifestBytes })

  // 7. 다운로드 — Fix D: all-underscore 또는 빈 sanitized 결과면 폴백 이름 사용
  const rawSanitized = project.metadata.title.replace(/[^a-z0-9]/gi, '_')
  const sanitizedTitle = /^_*$/.test(rawSanitized) ? 'sculptone-dataset' : rawSanitized
  const filename = `${sanitizedTitle}_dataset.zip`
  downloadBytes(zip, filename, 'application/zip')
}

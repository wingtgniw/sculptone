import type { Project } from '@sculptone/score-model'
import { audibleTrackIds, buildMultiSchedule } from '../audio/multitrack'

/**
 * 학습용 note-list 라벨.
 *
 * velocity: 0~1 정규화 float (= n.velocity / 127).
 *   buildMultiSchedule.velocity와 동일 — 렌더 오디오의 triggerAttackRelease에
 *   전달되는 값과 일치하므로 오디오·라벨 정렬이 보장됨.
 */
export interface NoteLabel {
  onset_s: number // 절대 시작 시간(초)
  offset_s: number // 절대 종료 시간(초)
  pitch: number // MIDI pitch 0~127
  velocity: number // 0~1 정규화
  track: string // trackId
}

/**
 * 프로젝트의 audible 트랙 노트를 onset_s 오름차순 NoteLabel 배열로 변환한다.
 * 소스: buildMultiSchedule (solo/mute 로직 포함).
 * 빈 프로젝트 / 노트 없음 → [] 반환.
 */
export function buildNoteLabels(project: Project): NoteLabel[] {
  const ids = audibleTrackIds(project)
  const items = buildMultiSchedule(project, ids)
  const labels: NoteLabel[] = items.map((item) => ({
    onset_s: item.timeSec,
    offset_s: item.timeSec + item.durationSec,
    pitch: item.pitch,
    velocity: item.velocity,
    track: item.trackId,
  }))
  labels.sort((a, b) => a.onset_s - b.onset_s || a.pitch - b.pitch)
  return labels
}

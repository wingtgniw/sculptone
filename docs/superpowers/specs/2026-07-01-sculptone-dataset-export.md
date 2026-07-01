# Sculptone — AI Dataset Export Phase 1 (Client-Side)

- 상태: Draft v1
- 작성일: 2026-07-01
- 범위: **AI 데이터 플라이휠 1단계 — 클라이언트 사이드 학습용 데이터셋 내보내기**
- 태그라인: *현재 프로젝트의 ground-truth 심볼릭 데이터(notes.json, notes.mid)와 렌더 오디오(audio.wav)를 하나의 ZIP으로 내보내 향후 AMT(자동 채보) 모델 학습 코퍼스로 활용한다.*

---

## 1. 목표

Sculptone 프로젝트 1개를 클라이언트 사이드에서 완결되는 흐름으로 학습용 데이터셋 ZIP으로 내보낸다. 백엔드/ML 인프라 없이 동작한다.

**핵심 원칙:**

1. **클라이언트 완결**: 서버 업로드 없이 브라우저에서 완전 처리. Blob 다운로드로 종결.
2. **정렬된 라벨 + 오디오**: MIDI/렌더 오디오 간 타임라인이 동일한 `buildMultiSchedule` 소스에서 파생 → 오프셋 어긋남 없음.
3. **순수 함수 우선**: labels / wav / manifest / bundle 핵심 경로는 DOM·Tone·AudioContext 의존 없이 순수 함수로 구현 → 완전 TDD 가능.
4. **기존 오디오 로직 재현**: `Tone.Offline` 콜백 내에서 `createInstrumentFromSound` + `buildMultiSchedule` → `playback.ts`의 재생 로직과 1:1 대응.

---

## 2. 비목표

이 단계에서 구현하지 않는 것:

- **배치 내보내기**: 여러 프로젝트 일괄 처리
- **서버 업로드 / 실제 ML 학습**: 클라이언트 내보내기로 종결
- **누적 데이터셋 관리**: 로컬 라이브러리, 인덱스 파일 관리
- **리샘플링 / 다운믹스 옵션**: 고정 44100 Hz 스테레오 16-bit PCM 출력
- **재생 상태 기반 렌더**: 현재 재생 헤드 위치와 무관하게 프로젝트 전체 렌더
- **인프라 / CI 파일 수정**: `.github/`, 루트 eslint/prettier, `allowedBuilds`
- **`packages/score-model`, `packages/sound-engine` 수정**: 기존 패키지 불변

---

## 3. 아키텍처 / 데이터 흐름

```
FileMenu
  "Export Training Data" 클릭
    → downloadDataset(currentProject)          [bundle.ts]
        ├── renderProjectAudio(project)         [renderAudio.ts]  → AudioBuffer
        │     └── Tone.Offline(callback, durationSec, 2, 44100)
        │           ├── audibleTrackIds(project) → string[]
        │           ├── buildMultiSchedule(project, ids) → MultiScheduleItem[]
        │           ├── createInstrumentFromSound(track.sound) per track
        │           └── inst.triggerAttackRelease(note, dur, time, vel) per item
        ├── encodeWav(audioBuffer, 44100)       [wav.ts]          → Uint8Array
        ├── buildNoteLabels(project)            [labels.ts]       → NoteLabel[]
        │     └── audibleTrackIds + buildMultiSchedule → 정렬된 note-list
        ├── projectToMidi(project)              [score-model]     → Uint8Array (재사용)
        ├── buildManifest(project, {...})        [manifest.ts]     → Manifest
        └── buildDatasetZip({wav, notesJson, midi, manifest})
              └── fflate.zipSync({...})          [bundle.ts]       → Uint8Array
                    → downloadBytes(zip, filename, 'application/zip') [io/files.ts]
```

**라벨/오디오 정렬 보장**: `buildNoteLabels`와 `renderProjectAudio` 둘 다 `buildMultiSchedule`에서 파생되므로 `onset_s / offset_s` 타임스탬프가 렌더 오디오의 노트 타이밍과 정확히 일치한다.

---

## 4. 핵심 타입 정의

```typescript
// labels.ts
export interface NoteLabel {
  onset_s: number     // 절대 시작 시간(초) — buildMultiSchedule.timeSec
  offset_s: number    // 절대 종료 시간(초) — timeSec + durationSec
  pitch: number       // MIDI pitch 0~127
  velocity: number    // 0~1 정규화 float (= n.velocity / 127, buildMultiSchedule.velocity와 동일)
  track: string       // trackId
}
// 정렬: onset_s 오름차순 (동점 시 pitch 오름차순)

// manifest.ts
export interface Manifest {
  schemaVersion: string             // '1.0.0'
  projectId: string
  title: string
  tempo: number                     // BPM
  ppq: number
  timeSignature: [number, number]
  sampleRate: number                // 44100
  channels: number                  // 2 (stereo)
  bitDepth: number                  // 16
  durationSec: number               // 실제 렌더 오디오 길이 (content + tail)
  noteCount: number                 // NoteLabel 배열 길이
  exportedAt: string                // ISO 8601
  files: string[]                   // ['audio.wav', 'notes.json', 'notes.mid', 'manifest.json']
}
```

---

## 5. 컴포넌트 스펙

### 5.1 라벨 — `apps/web/src/dataset/labels.ts` (순수)

```typescript
import type { Project } from '@sculptone/score-model'
import { audibleTrackIds, buildMultiSchedule } from '../audio/multitrack'

export function buildNoteLabels(project: Project): NoteLabel[]
```

**동작:**
1. `audibleTrackIds(project)` → audibleIds (solo 우선, 없으면 non-muted)
2. `buildMultiSchedule(project, audibleIds)` → `MultiScheduleItem[]`
3. 각 item을 `NoteLabel`로 매핑:
   - `onset_s = item.timeSec`
   - `offset_s = item.timeSec + item.durationSec`
   - `pitch = item.pitch`
   - `velocity = item.velocity` (이미 0~1 정규화된 값)
   - `track = item.trackId`
4. `onset_s` 오름차순 정렬 → 동점 시 `pitch` 오름차순

**엣지:**
- 노트 없음 → 빈 배열 `[]` 반환 (에러 없음)
- 멀티트랙: 모든 audible 트랙 통합 후 정렬

**velocity 명시:** `n.velocity / 127` (0~1 float). `1.0 = MIDI velocity 127`. 이 값이 `Tone.Offline` 렌더 시 `triggerAttackRelease`에 전달되는 값과 동일하므로 오디오와 라벨이 완벽 정렬됨.

---

### 5.2 WAV 인코더 — `apps/web/src/dataset/wav.ts` (순수)

```typescript
export function encodeWav(
  buffer: {
    numberOfChannels: number
    length: number                         // 샘플 수 (per channel)
    getChannelData(channel: number): Float32Array
  },
  sampleRate: number,
): Uint8Array
```

**출력 포맷: 44.1kHz 스테레오 16-bit PCM WAV (RIFF)**

RIFF WAV 헤더 (44 bytes):
```
'RIFF' (4)  ChunkSize=36+dataSize (4 LE)  'WAVE' (4)
'fmt ' (4)  Subchunk1Size=16 (4 LE)
AudioFormat=1 PCM (2 LE)  NumChannels=2 (2 LE)
SampleRate (4 LE)  ByteRate=SampleRate*4 (4 LE)
BlockAlign=4 (2 LE)  BitsPerSample=16 (2 LE)
'data' (4)  Subchunk2Size=length*channels*2 (4 LE)
```

**인터리빙:** 샘플 순서 = `[L0, R0, L1, R1, ...]` (표준 PCM interleaved stereo)

**Float32 → Int16 변환:**
```typescript
const clamped = Math.max(-1.0, Math.min(1.0, sample))
const int16 = Math.round(clamped * 32767)
// DataView.setInt16(offset, int16, true)  // littleEndian=true
```

**모노 입력 처리:** `buffer.numberOfChannels === 1`이면 두 채널 모두 동일한 채널 데이터를 사용 (모노→스테레오 업믹스).

**엣지:**
- 길이 0 샘플: 헤더만 포함된 최소 WAV (dataSize=0) 반환
- 클램핑으로 over/under-flow 방지 (Float32 범위 초과 값 안전 처리)

**테스트 전략:** DOM·WebAudio 의존 없이 순수 객체로 페이크 buffer 생성 가능:
```typescript
const fakeBuffer = {
  numberOfChannels: 2, length: 4,
  getChannelData: (ch: number) => ch === 0
    ? new Float32Array([1.0, -1.0, 0.0, 0.5])
    : new Float32Array([0.5, 0.0, -1.0, 1.0]),
}
const wav = encodeWav(fakeBuffer, 44100)
// 바이트 검증: 헤더, 샘플 값, 전체 길이
```

---

### 5.3 Manifest — `apps/web/src/dataset/manifest.ts` (순수)

```typescript
export function buildManifest(
  project: Project,
  opts: { sampleRate: number; durationSec: number; noteCount: number },
): Manifest
```

**필드 매핑:**
- `schemaVersion`: `'1.0.0'` (하드코딩)
- `projectId`: `project.id`
- `title`: `project.metadata.title`
- `tempo`: `project.transport.tempo`
- `ppq`: `project.transport.ppq`
- `timeSignature`: `project.transport.timeSignature` (튜플 `[number, number]`)
- `sampleRate`: `opts.sampleRate`
- `channels`: `2` (하드코딩 — 항상 스테레오)
- `bitDepth`: `16` (하드코딩)
- `durationSec`: `opts.durationSec` (실제 렌더 오디오 길이, tail 포함)
- `noteCount`: `opts.noteCount`
- `exportedAt`: `new Date().toISOString()`
- `files`: `['audio.wav', 'notes.json', 'notes.mid', 'manifest.json']`

---

### 5.4 오디오 렌더 — `apps/web/src/dataset/renderAudio.ts`

```typescript
import * as Tone from 'tone'
import { createInstrumentFromSound } from '@sculptone/sound-engine'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from '../audio/multitrack'
import type { Project } from '@sculptone/score-model'

const RENDER_TAIL_SEC = 2.0  // 리버브/딜레이 여운 여유

export async function renderProjectAudio(
  project: Project,
  opts: { sampleRate: number },
): Promise<AudioBuffer>
```

**`Tone.Offline` 콜백 내 로직:**

```typescript
const audibleIds = audibleTrackIds(project)
const items = buildMultiSchedule(project, audibleIds)
const contentEndSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
const durationSec = contentEndSec + RENDER_TAIL_SEC  // 최소 RENDER_TAIL_SEC

const toneBuffer = await Tone.Offline(async () => {
  // 트랙별 악기 재생성 (offline context에서 새로 생성)
  const instMap = new Map<string, PatchInstrument>()
  for (const trackId of audibleIds) {
    const track = project.tracks.find(t => t.id === trackId)
    if (!track) continue
    const inst = createInstrumentFromSound(track.sound as SoundInput)
    inst.volume.value = linearToDb(track.mixer.volume)  // 믹서 볼륨 반영
    instMap.set(trackId, inst)
  }

  // 노트 스케줄 (playback.ts와 동일 로직)
  for (const item of items) {
    const inst = instMap.get(item.trackId)
    if (!inst) continue
    const note = Tone.Frequency(item.pitch, 'midi').toNote()
    inst.triggerAttackRelease(note, item.durationSec, item.timeSec, item.velocity)
  }
}, durationSec, 2, opts.sampleRate)

const audioBuffer = toneBuffer.get()
if (!audioBuffer) throw new Error('[renderAudio] Offline render returned no buffer')
return audioBuffer
```

**빈 프로젝트 처리:** 노트 없으면 `contentEndSec = 0` → `durationSec = RENDER_TAIL_SEC = 2.0s` → 무음 스테레오 버퍼 반환 (에러 없음).

**주의사항:**
- `Tone.Offline` 콜백 내에서 `new Tone.PolySynth()` 등이 자동으로 offline context에 연결됨 (Tone.js v15 동작).
- `triggerAttackRelease(note, durationSec, time, velocity)`: `time`은 절대 초(transport 기준 0부터), offline 컨텍스트에서는 그대로 사용.
- `PatchInstrument`의 `dispose()` 호출: Tone.Offline이 완료된 후 콜백 내 노드는 자동 정리됨 (offline context scoped). 명시적 dispose 불필요.

---

### 5.5 번들 — `apps/web/src/dataset/bundle.ts`

**ZIP 번들:**

```typescript
import { zipSync } from 'fflate'
import { downloadBytes } from '../io/files'

export function buildDatasetZip(files: {
  wav: Uint8Array
  notesJson: Uint8Array      // JSON.stringify(NoteLabel[]) → TextEncoder
  midi: Uint8Array
  manifest: Uint8Array       // JSON.stringify(Manifest) → TextEncoder
}): Uint8Array
```

`fflate.zipSync` 사용:
```typescript
return zipSync({
  'audio.wav': files.wav,
  'notes.json': files.notesJson,
  'notes.mid': files.midi,
  'manifest.json': files.manifest,
})
```

**ZIP 파일명 규칙:** `${sanitize(project.metadata.title)}_dataset.zip`
- `sanitize(title)`: `title.replace(/[^a-z0-9]/gi, '_') || 'untitled'`

**오케스트레이션:**

```typescript
export async function downloadDataset(project: Project): Promise<void>
```

내부 순서:
1. `renderProjectAudio(project, { sampleRate: 44100 })` → `AudioBuffer`
2. `encodeWav(audioBuffer, 44100)` → `Uint8Array` (wav)
3. `buildNoteLabels(project)` → `NoteLabel[]`
4. `new TextEncoder().encode(JSON.stringify(labels, null, 2))` → notesJson
5. `projectToMidi(project)` → `Uint8Array` (midi)
6. `buildManifest(project, { sampleRate: 44100, durationSec: audioBuffer.duration, noteCount: labels.length })` → `Manifest`
7. `new TextEncoder().encode(JSON.stringify(manifest, null, 2))` → manifestBytes
8. `buildDatasetZip({ wav, notesJson, midi, manifest: manifestBytes })` → `Uint8Array`
9. `downloadBytes(zip, filename, 'application/zip')`

---

### 5.6 UI — FileMenu 버튼

**위치:** `apps/web/src/ui/FileMenu.tsx` — 기존 Export 버튼들 뒤에 추가.

**구현:**
```tsx
const [isExporting, setIsExporting] = useState(false)
const [exportError, setExportError] = useState<string | null>(null)

const handleExportDataset = async () => {
  setIsExporting(true)
  setExportError(null)
  try {
    await downloadDataset(project)
  } catch (err) {
    console.error('[FileMenu] Dataset export failed:', err)
    setExportError('데이터셋 내보내기 실패')
  } finally {
    setIsExporting(false)
  }
}
```

버튼 텍스트: `isExporting ? 'Exporting...' : 'Export Training Data'`
에러 메시지: `exportError` 인라인 표시 (기존 `importError`와 동일 패턴).

---

## 6. 에러 / 엣지 처리

| 상황 | 처리 |
|---|---|
| 노트 없는 빈 프로젝트 | `buildNoteLabels → []`, `renderProjectAudio → 2초 무음 버퍼`. ZIP 정상 생성 (notes.json = `[]`). |
| Muted 전체 / Solo 없음 | `audibleTrackIds → []` → 위와 동일 (무음 + 빈 라벨) |
| `Tone.Offline` 예외 | `downloadDataset`에서 catch → UI 에러 메시지 표시 |
| `toneBuffer.get() === undefined` | `renderProjectAudio`에서 throw → 위에서 catch |
| 대형 프로젝트 (긴 오디오) | `isExporting=true`로 버튼 비활성. 렌더가 수 초 걸릴 수 있음. 프로그레스 바는 비목표. |
| 오디오 컨텍스트 미가용 (비브라우저 환경) | Tone.js가 throw → `downloadDataset` catch 처리 |
| `fflate.zipSync` 메모리 초과 | 매우 큰 프로젝트에서 OOM 가능. 현재 단계에서는 미대응 (비목표). |

---

## 7. 의존성

```bash
pnpm --filter @sculptone/web add fflate
```

- `fflate`: 순수 JS ZIP 라이브러리. wasm/native 없음, 브라우저/Node 모두 동작.
- `zipSync`: 동기 압축. 대용량이 아닌 한 블로킹 이슈 없음.
- 기타: 기존 의존성 재사용 (`tone`, `@sculptone/score-model`, `@sculptone/sound-engine`)

---

## 8. 파일 구조

```
apps/web/
  src/
    dataset/
      labels.ts                    NEW: buildNoteLabels (순수)
      wav.ts                       NEW: encodeWav (순수)
      manifest.ts                  NEW: buildManifest (순수)
      renderAudio.ts               NEW: renderProjectAudio (Tone.Offline)
      bundle.ts                    NEW: buildDatasetZip + downloadDataset
      test/
        labels.test.ts             NEW: 완전 TDD (~8개)
        wav.test.ts                NEW: 완전 TDD (~10개)
        manifest.test.ts           NEW: 완전 TDD (~6개)
        renderAudio.test.ts        NEW: Tone.Offline mock TDD (~5개)
        bundle.test.ts             NEW: fflate + Blob mock TDD (~8개)

  src/ui/
    FileMenu.tsx                   MOD: "Export Training Data" 버튼 + 상태 추가

변경 없는 파일:
- apps/web/src/audio/multitrack.ts — 완전 불변 (buildMultiSchedule 재사용만)
- apps/web/src/audio/playback.ts — 완전 불변
- apps/web/src/io/files.ts — 완전 불변 (downloadBytes 재사용만)
- packages/score-model/** — 완전 불변 (projectToMidi 재사용만)
- packages/sound-engine/** — 완전 불변 (createInstrumentFromSound 재사용만)
- CI/인프라 파일 전체 — 완전 불변
```

---

## 9. 결정 로그

**velocity: 0~1 정규화 float 선택 (vs 0~127 정수)**
`buildMultiSchedule.velocity = n.velocity / 127`이 렌더 시 `triggerAttackRelease`에 직접 전달되는 값이다. 같은 소스에서 파생된 라벨이 렌더 오디오와 완벽 정렬됨. 역변환 없이 단일 소스 원칙 준수. MAESTRO 등 주요 AMT 데이터셋도 정규화 float 사용.

**라벨 소스 = `buildMultiSchedule` (vs 직접 track.notes 순회)**
`audibleTrackIds`의 solo/mute 로직을 그대로 활용. 재생 엔진과 동일한 뷰 → 오디오와 라벨의 트랙 구성이 일치.

**WAV: RIFF 헤더 직접 구성 (vs Web Audio API `OfflineAudioContext` 내보내기)**
순수 함수 구현으로 TDD 가능. `encodeWav`는 AudioContext 없이 Float32Array + 헤더 계산만 수행.

**fflate.zipSync: 동기 압축 선택**
AMT 코퍼스 수준의 파일 크기(수 MB 이하)에서 블로킹 무시 가능. `zipAsync` 대비 코드 단순.

**`RENDER_TAIL_SEC = 2.0`**: 리버브 decay (최대 2초 설정 가능)와 딜레이 꼬리를 커버하는 여유. AMT 학습에서 꼬리 소리도 라벨 `offset_s` 이후로 정상 처리됨.

**악기 재생성 (Tone.Offline 콜백 내)**: Tone.Offline은 콜백 내에서 생성된 모든 Tone 노드를 자동으로 offline context에 연결한다. `createInstrumentFromSound`를 직접 호출하면 preset/patch 두 경로 모두 커버됨. 기존 `useAudio.ts`의 `buildTrackInstrument` 함수를 분리하지 않고 `createInstrumentFromSound`를 직접 재사용하는 이유: `useAudio.ts`는 React 훅 내부 구현이라 외부 노출이 어렵고, `createInstrumentFromSound`가 이미 두 경로를 처리하는 단일 진입점이기 때문.

**`downloadDataset` 에러 처리**: 함수 자체는 throw. UI(`FileMenu`)에서 try/catch로 에러 상태 관리. 순수 함수들과 UI 상태를 분리.

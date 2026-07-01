# Sculptone Dataset Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 현재 프로젝트 1개를 클라이언트 사이드에서 완결되는 학습용 데이터셋 ZIP(audio.wav + notes.json + notes.mid + manifest.json)으로 내보낸다. FileMenu에 "Export Training Data" 버튼 추가.

**Architecture:**
1. `fflate` 의존성 설치 + `apps/web/src/dataset/` 디렉토리 구조
2. `dataset/labels.ts` — `buildNoteLabels` 순수 함수 (완전 TDD)
3. `dataset/wav.ts` — `encodeWav` 순수 함수 (완전 TDD)
4. `dataset/manifest.ts` — `buildManifest` 순수 함수 (완전 TDD)
5. `dataset/renderAudio.ts` — `renderProjectAudio` (Tone.Offline mock TDD)
6. `dataset/bundle.ts` — `buildDatasetZip` + `downloadDataset` (fflate + Blob mock TDD)
7. UI — `FileMenu.tsx` "Export Training Data" 버튼 + 스모크
8. 최종 게이트 (커버리지 82%+, eslint 0, prettier)

**Mock 전략 요약:**
- `labels.ts` / `wav.ts` / `manifest.ts` 테스트: mock 없음 (순수 함수, DOM·Tone 의존 전혀 없음).
- `renderAudio.test.ts`: `vi.mock('tone', () => ({ Offline: vi.fn(...), Frequency: vi.fn(...) }))` + `vi.mock('@sculptone/sound-engine', () => ({ createInstrumentFromSound: mockInstFn }))`. `Offline` mock이 콜백을 즉시 호출 후 페이크 `ToneAudioBuffer`(`.get()` → 페이크 AudioBuffer) 반환.
- `bundle.test.ts`: `vi.mock('../renderAudio', ...)` + `vi.mock('../wav', ...)` + `vi.mock('../labels', ...)` + `vi.mock('../manifest', ...)` + `vi.mock('@sculptone/score-model', ...)` + `URL.createObjectURL` / `document.createElement('a')` stubbing. `buildDatasetZip`은 실제 fflate + `fflate.unzipSync`로 라운드트립 검증.
- UI 스모크: `vi.mock('../dataset/bundle', ...)` — `downloadDataset` mock.

**Tech Stack:** React 18 + TS · Vitest 2.1.9 (jsdom) · @testing-library/react · fflate · tone (Offline) · @sculptone/sound-engine · @sculptone/score-model

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `apps/web/src/audio/multitrack.ts` — `buildMultiSchedule`, `audibleTrackIds`, `linearToDb`
> - `apps/web/src/audio/playback.ts` — 재생 엔진 (renderAudio는 동일 로직 재현)
> - `apps/web/src/io/files.ts` — `downloadBytes`
> - `packages/score-model/src/midi.ts` — `projectToMidi`
> - `packages/sound-engine/src/instrument.ts` — `createInstrumentFromSound`
> - `apps/web/src/ui/FileMenu.tsx` — 기존 버튼들 (New / Export MIDI / Export JSON / Export MusicXML / Import MIDI)

---

## 비목표 (이 계획에서 하지 말 것)

- 배치/누적/서버 업로드/실제 ML 학습
- 리샘플링/다운믹스 옵션
- `packages/` 수정
- **인프라/CI 파일 변경** (`.github/`, 루트 설정, `allowedBuilds`)
- 프로그레스바/실시간 렌더 진행 표시

---

## 설계 근거

### buildMultiSchedule 소스 단일 원칙
`buildNoteLabels`와 `renderProjectAudio` 모두 `buildMultiSchedule`에서 파생. `velocity = n.velocity / 127` (0~1 float)이 렌더 엔진(`triggerAttackRelease`)과 라벨 모두에 동일하게 전달 → 오프셋/스케일 오차 없음.

### Tone.Offline 악기 재생성 방식
`Tone.Offline(callback, ...)` 내에서 Tone.js가 임시로 offline AudioContext를 설정. 콜백 내 `new Tone.PolySynth()` 등은 자동으로 offline context에 연결됨. `createInstrumentFromSound(track.sound)`를 직접 호출하면 preset/patch 두 경로 모두 처리됨. 테스트에서는 `createInstrumentFromSound`를 mock으로 대체해 실제 Tone 노드 생성 없이 `triggerAttackRelease` 호출만 검증.

### WAV 16-bit PCM 순수 구현
`encodeWav`는 `Float32Array` → `Int16` 변환 + RIFF 헤더를 DataView로 직접 구성. AudioContext 의존 없음. jsdom에서 전체 단위테스트 가능.

### fflate zipSync
순수 JS ZIP. 동기 API(`zipSync`)로 코드 단순화. 테스트에서 `fflate.unzipSync`로 라운드트립 검증 가능.

---

## File Structure

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
    FileMenu.tsx                   MOD: isExporting 상태 + handleExportDataset

변경 없는 파일:
- apps/web/src/audio/multitrack.ts, playback.ts, useAudio.ts
- apps/web/src/io/files.ts
- packages/score-model/**, packages/sound-engine/**
- CI/인프라 파일 전체
```

---

## Task 1: 의존성 설치 + 디렉토리 구조

**Files:** `package.json` (apps/web), `apps/web/src/dataset/` 디렉토리 생성

- [ ] **Step 1: fflate 의존성 설치**

```bash
pnpm --filter @sculptone/web add fflate
```

Expected: `apps/web/package.json`에 `"fflate": "^x.y.z"` 추가됨.

- [ ] **Step 2: 디렉토리 구조 생성**

`apps/web/src/dataset/` 디렉토리와 `apps/web/src/dataset/test/` 디렉토리를 생성한다. (빈 파일 생성 불필요 — 각 Task에서 파일 생성.)

- [ ] **Step 3: 설치 검증**

```bash
pnpm --filter @sculptone/web exec node -e "const { zipSync } = require('fflate'); console.log(typeof zipSync)"
```

Expected: `function` 출력.

---

## Task 2: `labels.ts` 완전 TDD

**Files:**
- Create `apps/web/src/dataset/test/labels.test.ts`
- Create `apps/web/src/dataset/labels.ts`

### Task 2a: 테스트 먼저 작성

- [ ] **Step 1: `labels.test.ts` 작성 (실패 상태)**

Create `apps/web/src/dataset/test/labels.test.ts`:

```typescript
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
    expect(labels[0]!.velocity).toBeCloseTo(127 / 127)  // 1.0
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
    const tracks = labels.map(l => l.track)
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
      tracks: p.tracks.map(t =>
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- "labels.test"
```

Expected: FAIL — `'../labels'` 모듈 없음.

### Task 2b: 구현

- [ ] **Step 3: `labels.ts` 구현**

Create `apps/web/src/dataset/labels.ts`:

```typescript
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
  onset_s: number   // 절대 시작 시간(초)
  offset_s: number  // 절대 종료 시간(초)
  pitch: number     // MIDI pitch 0~127
  velocity: number  // 0~1 정규화
  track: string     // trackId
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
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "labels.test"
```

Expected: **8개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 3: `wav.ts` 완전 TDD

**Files:**
- Create `apps/web/src/dataset/test/wav.test.ts`
- Create `apps/web/src/dataset/wav.ts`

### Task 3a: 테스트 먼저 작성

- [ ] **Step 1: `wav.test.ts` 작성 (실패 상태)**

Create `apps/web/src/dataset/test/wav.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// 순수 함수 — AudioContext·DOM mock 없음
import { encodeWav } from '../wav'

// ── 페이크 AudioBuffer 헬퍼 ─────────────────────────────────────────────────
function mkFakeBuffer(
  channels: Float32Array[],
  sampleRate = 44100,
) {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    sampleRate,
    getChannelData: (ch: number) => channels[ch]!,
  }
}

// DataView 헬퍼: 리틀엔디언
function readU32LE(view: DataView, offset: number) {
  return view.getUint32(offset, true)
}
function readU16LE(view: DataView, offset: number) {
  return view.getUint16(offset, true)
}
function readI16LE(view: DataView, offset: number) {
  return view.getInt16(offset, true)
}

describe('encodeWav', () => {
  // ── 헤더 구조 검증 ───────────────────────────────────────────

  it('RIFF 시그니처가 오프셋 0에 있다', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 'RIFF' = 0x52494646
    expect(view.getUint8(0)).toBe(0x52) // R
    expect(view.getUint8(1)).toBe(0x49) // I
    expect(view.getUint8(2)).toBe(0x46) // F
    expect(view.getUint8(3)).toBe(0x46) // F
  })

  it('WAVE 포맷 마커가 오프셋 8에 있다', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(view.getUint8(8)).toBe(0x57)   // W
    expect(view.getUint8(9)).toBe(0x41)   // A
    expect(view.getUint8(10)).toBe(0x56)  // V
    expect(view.getUint8(11)).toBe(0x45)  // E
  })

  it('fmt 서브청크 오프셋·크기 검증', () => {
    const buf = mkFakeBuffer([new Float32Array([0, 0]), new Float32Array([0, 0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // Subchunk1Size = 16 (offset 16)
    expect(readU32LE(view, 16)).toBe(16)
    // AudioFormat = 1 (PCM, offset 20)
    expect(readU16LE(view, 20)).toBe(1)
    // NumChannels = 2 (offset 22)
    expect(readU16LE(view, 22)).toBe(2)
  })

  it('SampleRate가 헤더에 올바르게 기록된다 (offset 24)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readU32LE(view, 24)).toBe(44100)
  })

  it('ByteRate = SampleRate * NumChannels * BitsPerSample/8 (offset 28)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 44100 * 2 * 2 = 176400
    expect(readU32LE(view, 28)).toBe(44100 * 2 * 2)
  })

  it('BitsPerSample = 16 (offset 34)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readU16LE(view, 34)).toBe(16)
  })

  // ── 데이터 크기 검증 ─────────────────────────────────────────

  it('전체 출력 크기 = 44(header) + numSamples * 4(stereo 16bit)', () => {
    // 4샘플 스테레오
    const buf = mkFakeBuffer([
      new Float32Array([0, 0.5, -0.5, 1.0]),
      new Float32Array([0.25, -0.25, 0.75, -0.75]),
    ])
    const wav = encodeWav(buf, 44100)
    // 44 + 4 samples * 2 channels * 2 bytes = 44 + 16 = 60
    expect(wav.byteLength).toBe(44 + 4 * 2 * 2)
  })

  // ── Float32 → Int16 변환 검증 ────────────────────────────────

  it('1.0 → 32767 (최대값)', () => {
    const buf = mkFakeBuffer([new Float32Array([1.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 44 = header end; offset 44 = 첫 샘플 (L0)
    expect(readI16LE(view, 44)).toBe(32767)
  })

  it('-1.0 → -32768 (최소값)', () => {
    const buf = mkFakeBuffer([new Float32Array([-1.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(-32768)
  })

  it('0.0 → 0', () => {
    const buf = mkFakeBuffer([new Float32Array([0.0]), new Float32Array([0.0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(0)
    expect(readI16LE(view, 46)).toBe(0)
  })

  // ── 스테레오 인터리빙 검증 ───────────────────────────────────

  it('인터리빙: [L0, R0, L1, R1, ...] 순서', () => {
    const buf = mkFakeBuffer([
      new Float32Array([1.0, 0.0]),   // L0=1.0, L1=0.0
      new Float32Array([0.0, 1.0]),   // R0=0.0, R1=1.0
    ])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // offset 44: L0 = 32767
    expect(readI16LE(view, 44)).toBe(32767)  // L0
    // offset 46: R0 = 0
    expect(readI16LE(view, 46)).toBe(0)      // R0
    // offset 48: L1 = 0
    expect(readI16LE(view, 48)).toBe(0)      // L1
    // offset 50: R1 = 32767
    expect(readI16LE(view, 50)).toBe(32767)  // R1
  })

  // ── 클램핑 ──────────────────────────────────────────────────

  it('2.0(over) → 32767 (클램핑)', () => {
    const buf = mkFakeBuffer([new Float32Array([2.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(32767)
  })

  it('-2.0(under) → -32768 (클램핑)', () => {
    const buf = mkFakeBuffer([new Float32Array([-2.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(-32768)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- "wav.test"
```

Expected: FAIL — `'../wav'` 모듈 없음.

### Task 3b: 구현

- [ ] **Step 3: `wav.ts` 구현**

Create `apps/web/src/dataset/wav.ts`:

```typescript
/**
 * AudioBuffer-like 인터페이스 → 44.1kHz 스테레오 16-bit PCM WAV (RIFF).
 *
 * 순수 함수 — AudioContext / DOM 의존 없음.
 * 테스트는 페이크 buffer 객체(numberOfChannels/length/getChannelData)로 직접 검증.
 *
 * RIFF WAV 헤더 (44 bytes):
 *   [0 ] 'RIFF' (4)  ChunkSize (4 LE)  'WAVE' (4)
 *   [12] 'fmt ' (4)  16 (4 LE)  AudioFormat=1 (2 LE)  NumChannels=2 (2 LE)
 *   [24] SampleRate (4 LE)  ByteRate=SR*4 (4 LE)  BlockAlign=4 (2 LE)  BitsPerSample=16 (2 LE)
 *   [36] 'data' (4)  DataSize (4 LE)
 *   [44] interleaved 16-bit LE PCM samples [L0,R0,L1,R1,...]
 */
export function encodeWav(
  buffer: {
    numberOfChannels: number
    length: number
    getChannelData(channel: number): Float32Array
  },
  sampleRate: number,
): Uint8Array {
  const numChannels = 2           // 항상 스테레오 출력
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = buffer.length * blockAlign
  const totalSize = 44 + dataSize

  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  // ── 채널 데이터 획득 (모노 입력 → 스테레오 업믹스) ──────────────
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels >= 2
    ? buffer.getChannelData(1)
    : left   // 모노 → 두 채널에 동일 데이터

  // ── RIFF 청크 ──────────────────────────────────────────────────
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46  // 'RIFF'
  view.setUint32(4, 36 + dataSize, true)                        // ChunkSize
  out[8] = 0x57; out[9] = 0x41; out[10] = 0x56; out[11] = 0x45 // 'WAVE'

  // ── fmt 서브청크 ───────────────────────────────────────────────
  out[12] = 0x66; out[13] = 0x6D; out[14] = 0x74; out[15] = 0x20 // 'fmt '
  view.setUint32(16, 16, true)                 // Subchunk1Size
  view.setUint16(20, 1, true)                  // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true)         // NumChannels
  view.setUint32(24, sampleRate, true)          // SampleRate
  view.setUint32(28, byteRate, true)            // ByteRate
  view.setUint16(32, blockAlign, true)          // BlockAlign
  view.setUint16(34, bitsPerSample, true)       // BitsPerSample

  // ── data 서브청크 ──────────────────────────────────────────────
  out[36] = 0x64; out[37] = 0x61; out[38] = 0x74; out[39] = 0x61 // 'data'
  view.setUint32(40, dataSize, true)            // Subchunk2Size

  // ── 인터리빙: [L0, R0, L1, R1, ...] ───────────────────────────
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    const lClamped = Math.max(-1.0, Math.min(1.0, left[i]!))
    const rClamped = Math.max(-1.0, Math.min(1.0, right[i]!))
    // Float32 → Int16: [-1, 1] → [-32768, 32767]
    view.setInt16(offset, Math.round(lClamped * 32767), true)
    view.setInt16(offset + 2, Math.round(rClamped * 32767), true)
    offset += 4
  }

  return out
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "wav.test"
```

Expected: **12개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 4: `manifest.ts` 완전 TDD

**Files:**
- Create `apps/web/src/dataset/test/manifest.test.ts`
- Create `apps/web/src/dataset/manifest.ts`

### Task 4a: 테스트 먼저 작성

- [ ] **Step 1: `manifest.test.ts` 작성 (실패 상태)**

Create `apps/web/src/dataset/test/manifest.test.ts`:

```typescript
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- "manifest.test"
```

Expected: FAIL — `'../manifest'` 모듈 없음.

### Task 4b: 구현

- [ ] **Step 3: `manifest.ts` 구현**

Create `apps/web/src/dataset/manifest.ts`:

```typescript
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
  exportedAt: string  // ISO 8601
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
    timeSignature: [
      project.transport.timeSignature[0],
      project.transport.timeSignature[1],
    ],
    sampleRate: opts.sampleRate,
    channels: 2,
    bitDepth: 16,
    durationSec: opts.durationSec,
    noteCount: opts.noteCount,
    exportedAt: new Date().toISOString(),
    files: ['audio.wav', 'notes.json', 'notes.mid', 'manifest.json'],
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "manifest.test"
```

Expected: **7개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 5: `renderAudio.ts` — `Tone.Offline` mock TDD

**Files:**
- Create `apps/web/src/dataset/test/renderAudio.test.ts`
- Create `apps/web/src/dataset/renderAudio.ts`

이 모듈은 `Tone.Offline`과 `createInstrumentFromSound`에 의존하므로 완전 mock TDD 방식.

### Task 5a: 테스트 먼저 작성

- [ ] **Step 1: `renderAudio.test.ts` 작성 (실패 상태)**

Create `apps/web/src/dataset/test/renderAudio.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
} from '@sculptone/score-model'

// ── 페이크 AudioBuffer ────────────────────────────────────────────────────────
const mockAudioBuffer = {
  numberOfChannels: 2,
  length: 88200,       // 2sec at 44100
  sampleRate: 44100,
  duration: 2.0,
  getChannelData: () => new Float32Array(88200),
}

// ── Tone mock ─────────────────────────────────────────────────────────────────
// Offline: 콜백을 즉시 실행 후 페이크 ToneAudioBuffer 반환.
// Frequency: MIDI pitch → 노트 이름 (스텁).

const mockOffline = vi.fn(async (callback: () => Promise<void>) => {
  await callback()
  return { get: () => mockAudioBuffer }
})

const mockFrequency = vi.fn((_pitch: number, _unit: string) => ({
  toNote: () => 'C4',
}))

vi.mock('tone', () => ({
  Offline: mockOffline,
  Frequency: mockFrequency,
}))

// ── createInstrumentFromSound mock ────────────────────────────────────────────
const mockTriggerAttackRelease = vi.fn()
const mockInstrument = {
  triggerAttackRelease: mockTriggerAttackRelease,
  volume: { value: 0 },
  dispose: vi.fn(),
}
const mockCreateInstrumentFromSound = vi.fn(() => mockInstrument)

vi.mock('@sculptone/sound-engine', () => ({
  createInstrumentFromSound: mockCreateInstrumentFromSound,
}))

import { renderProjectAudio } from '../renderAudio'

describe('renderProjectAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOffline.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
      return { get: () => mockAudioBuffer }
    })
  })

  it('Tone.Offline이 sampleRate 옵션과 함께 호출된다', async () => {
    const p = createEmptyProject('T')
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockOffline).toHaveBeenCalledOnce()
    // Offline(callback, durationSec, channels, sampleRate)
    const [, , channels, sr] = mockOffline.mock.calls[0]!
    expect(channels).toBe(2)
    expect(sr).toBe(44100)
  })

  it('AudioBuffer를 반환한다 (ToneAudioBuffer.get() 결과)', async () => {
    const p = createEmptyProject('T')
    const result = await renderProjectAudio(p, { sampleRate: 44100 })
    expect(result).toBe(mockAudioBuffer)
  })

  it('트랙당 createInstrumentFromSound가 호출된다', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockCreateInstrumentFromSound).toHaveBeenCalledOnce()
  })

  it('노트 수만큼 triggerAttackRelease가 호출된다', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, track.id, createNote({ pitch: 64, start: 480, duration: 480, velocity: 80 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(2)
  })

  it('빈 프로젝트(노트 없음)도 AudioBuffer를 반환한다 (무음)', async () => {
    const p = createEmptyProject('Empty')
    const result = await renderProjectAudio(p, { sampleRate: 44100 })
    expect(result).toBe(mockAudioBuffer)
    // triggerAttackRelease는 호출되지 않아야 함
    expect(mockTriggerAttackRelease).not.toHaveBeenCalled()
  })

  it('durationSec = contentEndSec + RENDER_TAIL_SEC (>= RENDER_TAIL_SEC)', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    // 120BPM ppq480: start=480ticks=0.5sec, duration=480ticks=0.5sec → contentEnd=1.0sec
    p = addNote(p, track.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    // Offline의 두 번째 인수(durationSec)가 1.0 + RENDER_TAIL_SEC(2.0) = 3.0
    const [, durationSec] = mockOffline.mock.calls[0]!
    expect(durationSec as number).toBeCloseTo(3.0)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- "renderAudio.test"
```

Expected: FAIL — `'../renderAudio'` 모듈 없음.

### Task 5b: 구현

- [ ] **Step 3: `renderAudio.ts` 구현**

Create `apps/web/src/dataset/renderAudio.ts`:

```typescript
import * as Tone from 'tone'
import { createInstrumentFromSound, type SoundInput } from '@sculptone/sound-engine'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from '../audio/multitrack'
import type { Project } from '@sculptone/score-model'

/**
 * 리버브/딜레이 여운 여유. 마지막 노트 끝 이후 2초를 렌더에 추가한다.
 * AMT 학습에서 release tail을 포함하는 것이 중요.
 */
export const RENDER_TAIL_SEC = 2.0

/**
 * 프로젝트를 Tone.Offline으로 렌더해 AudioBuffer를 반환한다.
 *
 * 로직은 playback.ts의 createPlaybackEngine.play와 동일:
 * - audibleTrackIds → buildMultiSchedule
 * - 트랙별 createInstrumentFromSound (offline context에서 재생성)
 * - triggerAttackRelease로 절대 시간에 스케줄
 *
 * 빈 프로젝트: contentEndSec=0 → durationSec=RENDER_TAIL_SEC → 무음 버퍼 반환.
 */
export async function renderProjectAudio(
  project: Project,
  opts: { sampleRate: number },
): Promise<AudioBuffer> {
  const audibleIds = audibleTrackIds(project)
  const items = buildMultiSchedule(project, audibleIds)

  const contentEndSec = items.reduce(
    (m, it) => Math.max(m, it.timeSec + it.durationSec),
    0,
  )
  const durationSec = contentEndSec + RENDER_TAIL_SEC

  const toneBuffer = await Tone.Offline(
    async () => {
      // ── 트랙별 악기 재생성 (offline context 자동 적용) ──────────────
      const instMap = new Map<string, ReturnType<typeof createInstrumentFromSound>>()
      for (const trackId of audibleIds) {
        const track = project.tracks.find((t) => t.id === trackId)
        if (!track) continue
        const inst = createInstrumentFromSound(track.sound as SoundInput)
        inst.volume.value = linearToDb(track.mixer.volume)
        instMap.set(trackId, inst)
      }

      // ── 노트 스케줄 (playback.ts와 동일 로직) ────────────────────────
      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        const note = Tone.Frequency(item.pitch, 'midi').toNote()
        inst.triggerAttackRelease(note, item.durationSec, item.timeSec, item.velocity)
      }
    },
    durationSec,
    2,                // channels (스테레오)
    opts.sampleRate,
  )

  const audioBuffer = toneBuffer.get()
  if (!audioBuffer) {
    throw new Error('[renderAudio] Tone.Offline returned no AudioBuffer')
  }
  return audioBuffer
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "renderAudio.test"
```

Expected: **6개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. (Tone.Offline 타입과 SoundInput cast 확인.)

---

## Task 6: `bundle.ts` — fflate + 다운로드 TDD

**Files:**
- Create `apps/web/src/dataset/test/bundle.test.ts`
- Create `apps/web/src/dataset/bundle.ts`

### Task 6a: 테스트 먼저 작성

- [ ] **Step 1: `bundle.test.ts` 작성 (실패 상태)**

Create `apps/web/src/dataset/test/bundle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unzipSync } from 'fflate'
import { createEmptyProject } from '@sculptone/score-model'

// ── buildDatasetZip: 실제 fflate 사용, 라운드트립 검증 ─────────────────────

// ── downloadDataset mock 준비 ──────────────────────────────────────────────

// 페이크 AudioBuffer
const fakeAudioBuffer = {
  numberOfChannels: 2,
  length: 100,
  sampleRate: 44100,
  duration: 100 / 44100,
  getChannelData: () => new Float32Array(100),
}

const mockRenderProjectAudio = vi.fn(async () => fakeAudioBuffer)
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
const mockProjectToMidi = vi.fn(() => new Uint8Array([0x4D, 0x54, 0x68, 0x64])) // 'MThd' 스텁

vi.mock('../renderAudio', () => ({ renderProjectAudio: mockRenderProjectAudio }))
vi.mock('../wav', () => ({ encodeWav: mockEncodeWav }))
vi.mock('../labels', () => ({ buildNoteLabels: mockBuildNoteLabels }))
vi.mock('../manifest', () => ({ buildManifest: mockBuildManifest }))
vi.mock('@sculptone/score-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sculptone/score-model')>()
  return {
    ...actual,
    projectToMidi: mockProjectToMidi,
  }
})

// Blob 다운로드 mock (jsdom에는 URL.createObjectURL 없음)
const mockCreateObjectURL = vi.fn(() => 'blob:fake-url')
const mockRevokeObjectURL = vi.fn()
vi.stubGlobal('URL', {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL,
})

import { buildDatasetZip, downloadDataset } from '../bundle'

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
    const midi = new Uint8Array([0x4D, 0x54, 0x68, 0x64])
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
    mockCreateObjectURL.mockReturnValue('blob:fake-url')
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

  it('projectToMidi가 프로젝트와 함께 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockProjectToMidi).toHaveBeenCalledWith(p)
  })

  it('buildManifest가 sampleRate/durationSec/noteCount를 받아 호출된다', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockBuildManifest).toHaveBeenCalledWith(p, expect.objectContaining({
      sampleRate: 44100,
      noteCount: expect.any(Number),
      durationSec: expect.any(Number),
    }))
  })

  it('URL.createObjectURL이 Blob으로 호출된다 (다운로드 트리거)', async () => {
    const p = createEmptyProject('Test Song')
    await downloadDataset(p)
    expect(mockCreateObjectURL).toHaveBeenCalledOnce()
    const arg = mockCreateObjectURL.mock.calls[0]![0]
    expect(arg).toBeInstanceOf(Blob)
  })

  it('ZIP 파일명이 프로젝트 제목을 포함한다', async () => {
    const p = createEmptyProject('My Epic Song')
    await downloadDataset(p)
    // document.createElement('a').download 속성 확인은 jsdom 환경에서 어려우므로
    // URL.createObjectURL 호출 여부로 간접 검증
    expect(mockCreateObjectURL).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- "bundle.test"
```

Expected: FAIL — `'../bundle'` 모듈 없음.

### Task 6b: 구현

- [ ] **Step 3: `bundle.ts` 구현**

Create `apps/web/src/dataset/bundle.ts`:

```typescript
import { zipSync } from 'fflate'
import { projectToMidi } from '@sculptone/score-model'
import { downloadBytes } from '../io/files'
import { renderProjectAudio } from './renderAudio'
import { encodeWav } from './wav'
import { buildNoteLabels } from './labels'
import { buildManifest } from './manifest'
import type { Project } from '@sculptone/score-model'

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

  // 4. MIDI
  const midi = projectToMidi(project)

  // 5. Manifest (JSON)
  const manifest = buildManifest(project, {
    sampleRate: SAMPLE_RATE,
    durationSec: audioBuffer.duration,
    noteCount: labels.length,
  })
  const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2))

  // 6. ZIP
  const zip = buildDatasetZip({ wav, notesJson, midi, manifest: manifestBytes })

  // 7. 다운로드
  const sanitizedTitle = project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'
  const filename = `${sanitizedTitle}_dataset.zip`
  downloadBytes(zip, filename, 'application/zip')
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "bundle.test"
```

Expected: **10개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 7: UI 액션 — FileMenu 버튼 + 스모크

**Files:**
- Modify `apps/web/src/ui/FileMenu.tsx`
- Create `apps/web/src/ui/test/FileMenu.dataset.test.tsx` (스모크만)

- [ ] **Step 1: `FileMenu.tsx` 수정**

`apps/web/src/ui/FileMenu.tsx`에 다음을 추가한다:

**import 추가 (파일 상단 import 블록에):**
```typescript
import { useState } from 'react'
import { downloadDataset } from '../dataset/bundle'
```

**`FileMenu()` 함수 내부 — 기존 state 선언들과 함께:**
```typescript
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

**JSX 반환부 — 기존 "Export MusicXML" 버튼 뒤에 추가:**
```tsx
<button style={btnStyle} onClick={handleExportDataset} disabled={isExporting}>
  {isExporting ? 'Exporting...' : 'Export Training Data'}
</button>
{exportError && (
  <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
    {exportError}
  </span>
)}
```

> **주의:** 기존 `useState` import가 없으면 추가. 기존 `importError` state와 별도로 관리.

- [ ] **Step 2: UI 스모크 테스트 작성**

Create `apps/web/src/ui/test/FileMenu.dataset.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '../../state/store'

// bundle.ts mock
const mockDownloadDataset = vi.fn(async () => undefined)
vi.mock('../../dataset/bundle', () => ({
  downloadDataset: mockDownloadDataset,
}))

// 기존 FileMenu 의존성들 mock (MIDI/JSON/MusicXML export는 이 테스트 범위 밖)
vi.mock('@sculptone/score-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sculptone/score-model')>()
  return {
    ...actual,
    projectToMidi: vi.fn(() => new Uint8Array()),
    projectToMusicXML: vi.fn(() => ''),
  }
})

import { FileMenu } from '../FileMenu'

describe('FileMenu — Export Training Data 스모크', () => {
  it('"Export Training Data" 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /export training data/i })).toBeInTheDocument()
  })

  it('버튼 클릭 → downloadDataset이 현재 프로젝트와 함께 호출된다', async () => {
    render(<FileMenu />)
    const btn = screen.getByRole('button', { name: /export training data/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockDownloadDataset).toHaveBeenCalledOnce()
      expect(mockDownloadDataset).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.any(String) }),
      )
    })
  })

  it('내보내기 중 버튼이 비활성화된다', async () => {
    // downloadDataset이 promise를 즉시 해결하지 않도록 제어
    let resolveFn!: () => void
    mockDownloadDataset.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveFn = resolve }),
    )

    render(<FileMenu />)
    const btn = screen.getByRole('button', { name: /export training data/i })
    fireEvent.click(btn)

    // 버튼이 "Exporting..." 텍스트로 변경되고 disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled()
    })

    resolveFn()
    // 완료 후 버튼 복구
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export training data/i })).not.toBeDisabled()
    })
  })
})
```

- [ ] **Step 3: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "FileMenu.dataset.test"
```

Expected: **3개** PASS.

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 8: 최종 게이트

**이 태스크에서 CI 게이트 기준을 충족한다. 인프라 파일은 절대 수정하지 말 것.**

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
pnpm --filter @sculptone/web test
```

Expected:
- 기존 테스트 전체 통과 (audio/multitrack, playback, useAudio, metronome, score-model, midi 등 회귀 없음)
- 신규 테스트 (`labels`, `wav`, `manifest`, `renderAudio`, `bundle`, `FileMenu.dataset`) 전체 PASS

- [ ] **Step 2: 커버리지 확인**

```bash
pnpm --filter @sculptone/web test --coverage
```

Expected:
- 함수 커버리지 **82% 이상** 유지.
- 순수 함수 (`labels.ts`, `wav.ts`, `manifest.ts`, `buildDatasetZip`)는 100% 커버.
- `renderAudio.ts`, `downloadDataset`: Tone.Offline/Blob mock으로 주요 경로 커버.

- [ ] **Step 3: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

**React 타입 규칙 준수 확인:**
- `import { useState } from 'react'` (named import) — `import React from 'react'` 패턴 금지.
- `type CSSProperties` → `import type { CSSProperties } from 'react'`.

- [ ] **Step 4: ESLint 0 오류**

```bash
pnpm --filter @sculptone/web lint
```

Expected: 오류 0개.

- [ ] **Step 5: Prettier**

```bash
pnpm --filter @sculptone/web exec prettier --check "src/**/*.{ts,tsx}"
```

Expected: 포맷 위반 없음. 위반 있으면:

```bash
pnpm --filter @sculptone/web exec prettier --write "src/**/*.{ts,tsx}"
```

- [ ] **Step 6: 기존 audio 테스트 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- "audio/"
```

Expected: `multitrack.test.ts`, `playback.test.ts`, `useAudio.test.ts`, `metronome.test.ts` 전체 PASS.

`renderAudio.ts`의 `vi.mock('tone', ...)` scope가 기존 audio 테스트와 격리됨을 확인. (Vitest는 파일 단위 mock isolation 보장.)

---

## 우려 및 주의사항

### Tone.Offline 실제 동작 검증 (E2E 미구현)
`renderAudio.test.ts`는 mock이므로 실제 Tone.Offline 렌더 품질을 검증하지 않는다. 수동 E2E 테스트 필요: 실제 Sculptone 앱에서 "Export Training Data" 클릭 → ZIP 다운로드 → WAV를 오디오 편집기에서 열어 노트 타이밍 확인.

### Tone.Offline 내 SoundInput 타입 캐스트
`track.sound`는 `score-model`의 `Sound` 타입이고, `createInstrumentFromSound`는 `sound-engine`의 `SoundInput`을 기대한다. 두 패키지가 서로 의존하지 않으므로 구조적 타이핑으로 호환되지만 `as SoundInput` 캐스트가 필요할 수 있다. 구현 시 타입체크로 확인.

### Tone.Offline 타입 불일치
Tone.js v15의 TypeScript 타입에서 `Offline` 함수 시그니처가 버전마다 다를 수 있다. `toneBuffer.get()` 반환 타입이 `AudioBuffer | undefined`이므로 null 체크 필수. 구현에서 이를 명시.

### 대형 프로젝트 렌더 시간
10분짜리 프로젝트라면 Tone.Offline 렌더가 수십 초 걸릴 수 있다. UI 버튼 `isExporting=true`로 비활성화하지만 프로그레스 표시 없음. 현재 단계에서는 비목표.

### `encodeWav` 데이터 정확도
`Math.round(clamped * 32767)`는 `-1.0 → -32767`을 반환한다 (`-32768`이 아님). 테스트에서는 `-32768` 기대. 정확한 구현: `sample * 32767`이 아닌 `sample * 32768`을 쓰되 32767로 클램핑. 테스트 케이스와 구현이 일치하는지 구현 시 확인. (Task 3 테스트에서 `-1.0 → -32768`을 기대하므로 `Math.round(clamped * 32768)`이 맞음 — 구현 시 이 점 주의.)

> 계획 내 수정: `wav.ts` 구현에서 `Math.round(lClamped * 32767)` → `Math.round(lClamped * 32768)`이어야 `-1.0 → -32768` 테스트를 통과한다. 구현자는 이 점 확인 후 구현할 것.

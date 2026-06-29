# Sculptone — Creation Core (P0 + P1) 설계 문서

- 상태: Draft v1
- 작성일: 2026-06-29
- 범위: **P0 기반 + P1 만들기 코어 (MVP)**
- 디자인 참조: `documents/sculptone-design-guide.html` (Design Guide v0.2)
- 태그라인: *소리를 깎아 형태를 만든다 (Sculpt sound into form)*

---

## 1. 비전 — 데이터 플라이휠

Sculptone은 **작곡·연주·채보를 하나의 흐름으로 잇는 음악 워크스페이스**다. 핵심 전략은 데이터 플라이휠이다:

```
[만들기 코어]   작곡(피아노 롤) + 연주(재생) + MIDI 입력 캡처
                       ↓  심볼릭 정답 데이터 생산
[데이터 파이프라인]  악보/연주 → 오디오 렌더링  →  (오디오, 연주, 악보) 코퍼스
                       ↓
[AI 채보]       코퍼스로 AMT 모델 학습/파인튜닝  →  오디오→악보 추론
```

사용자가 앱 안에서 만든 음악은 **정답이 보장된 심볼릭 데이터**다. 이를 오디오로 렌더링하면 자동 채보(AMT) 학습에 필요한 정렬쌍이 공짜로 생긴다. 음색(timbre) 다양성은 P4에서 **데이터 증강**으로 작용한다. 따라서 채보를 "지금 어려운 ML"로 시작하지 않고, **만들기 코어가 곧 학습 데이터 공장**이 되며 AI 채보는 데이터가 쌓인 뒤의 보상으로 온다.

---

## 2. 이번 스펙의 범위

### 포함 (P0 + P1)

- **P0 기반**: pnpm 모노레포 스캐폴딩, 공유 `score-model`·`sound-engine` 패키지 골격, React+Vite 앱 셸, 디자인 토큰 시스템.
- **P1 만들기 코어 (MVP)**:
  - 3-모드 셸 (Compose / Play / Transcribe 탭) — Transcribe는 비활성 스텁.
  - **Compose**: 멀티 트랙 피아노 롤 에디터 (노트 그리기·이동·리사이즈·삭제, 양자화, 벨로시티/길이).
  - **Play**: Tone.js 재생, 트랜스포트(재생/정지/루프/템포), 재생헤드, 트랙별 믹서(볼륨/뮤트/솔로).
  - **MIDI 입력**: Web MIDI 실시간 녹음(양자화) + 스텝 입력.
  - **사운드**: 악기 프리셋 선택 (트랙별). 음색 스키마는 풀 패치까지 호환되게 설계(값은 P2에서 채움).
  - **저장/입출력**: IndexedDB 자동저장·불러오기, 내보내기(MIDI / MusicXML / JSON), 가져오기(MIDI).

### 비목표 (이번엔 하지 않음)

- 백엔드·계정·실시간 협업(P3)
- 본격 신스/사운드 디자인 UI(P2)
- 서버 오디오 렌더링·코퍼스 구축(P4)
- AI 채보 / 오디오→악보 변환(P5)
- 화면 위 스태프 기보 **편집** (P1은 내보내기용 MusicXML 직렬화까지만; 온스크린 스태프 뷰는 선택/후순위)
- 모바일 반응형 (데스크톱 우선)

---

## 3. 전체 단계 로드맵

| 단계 | 내용 | 산출물 |
|---|---|---|
| **P0** | 모노레포 + `score-model` + `sound-engine` 골격 + 앱 셸 + 디자인 토큰 | 스캐폴딩, 타입/스키마 |
| **P1 (이번)** | 피아노 롤 작곡 + 재생 + MIDI 입력 + 프리셋 + 로컬 저장/내보내기 | 동작하는 단일 사용자 에디터, **데이터 생산 시작** |
| **P2** | 사운드 디자인 스튜디오 (본격 신스·ADSR·필터·모듈레이션·이펙트 체인 + 커스텀 패치 저장) | 음색 편집 서브시스템 |
| **P3** | 저장·협업 (백엔드·인증·Yjs 실시간 공동편집·프리셋/패치 공유) | 본격 웹 서비스 |
| **P4** | 데이터 파이프라인 (악보+음색 → 오디오 렌더링, 코퍼스 구축) | 학습용 `(오디오, 연주, 악보)` 데이터셋 |
| **P5** | AI 채보 (코퍼스로 AMT 모델 학습/파인튜닝 + 오디오→악보 추론 통합) | 채보 기능 |

각 단계는 별도 스펙→계획→구현 사이클로 진행한다.

---

## 4. 디자인 언어 (Design Guide v0.2 요약)

상세는 `documents/sculptone-design-guide.html`. 앱 셸 단계에서 CSS 변수 토큰으로 그대로 구현한다.

- **원칙**: ① 흑백 우선 ② 단일 포인트(Copper) ③ 어두운 캔버스로 콘텐츠 집중 ④ 모드 간 토큰·컴포넌트 공유로 연속성.
- **색** (무채색 6단계 + 유채색 2색):
  - Inset `#070708` / Base `#0C0C0D` / Surface `#141415` / Elevated `#1D1D1F` / Border `#2A2A2C` / Border-Strong `#3A3A3D`
  - Text Hi `#F5F5F6` / Mid `#A6A6AA` / Lo `#6B6B70`
  - **Copper(포인트)** `#F2A65A`, hover `#C97E3C`, soft `rgba(242,166,90,.14)` — "현재 작업 대상 + 1차 액션"에만, 화면당 1~2곳.
  - **Record Red** `#E2685F` — 녹음 상태 전용.
- **타이포**: UI = Inter, 수치(시간·BPM) = JetBrains Mono, 악보 기보 = SMuFL(Bravura).
- **간격**: 4px 그리드 (4·8·12·16·24·32). **반경**: 6(칩)·10(컨트롤)·16(패널)·pill.
- **셸 레이아웃**: 상단 chrome + 툴바(모드 탭) · 좌측 소스 패널(트랙/믹서) · 중앙 캔버스(모드별 교체) · 우측 인스펙터 · 하단 트랜스포트.
- **공통 컴포넌트**: Button(primary copper / secondary / ghost / danger=record) · Transport bar · Slider · Tabs · Badge.

---

## 5. 핵심 데이터 모델

### 5.1 정본 = 시간 기반(PPQ) 모델

정본 편집 모델은 **시간 기반(performance-time, PPQ ticks)** 이다. 마디/성부 중심이 아니라 절대 음악 시간의 노트 목록. 이 선택은 피아노 롤 UI, MIDI 입력, AI 코퍼스(MAESTRO식 연주 MIDI)와 모두 일치한다.

```ts
// packages/score-model — 순수 TS, UI/오디오 의존성 0

interface Project {
  id: string
  metadata: { title: string; createdAt: string; updatedAt: string }
  transport: {
    ppq: number                 // ticks per quarter note (예: 480)
    tempo: number               // BPM
    timeSignature: [number, number]
    key: string                 // 예: "C"
  }
  tracks: Track[]
}

interface Track {
  id: string
  name: string
  color: string
  sound: Sound                  // §5.3
  mixer: { volume: number; pan: number; muted: boolean; soloed: boolean }
  notes: Note[]                 // 피아노 롤 노트 = 정본 편집 데이터
}

interface Note {
  id: string
  pitch: number                 // MIDI 0–127
  start: number                 // ticks (절대)
  duration: number              // ticks
  velocity: number              // 0–127
}
```

### 5.2 스태프 기보 = 파생 뷰/내보내기

마디·성부·음가·빔 등 **engraved notation은 정본에서 파생**한다. 양자화 + 기보 변환 단계(`notes → MusicXML / VexFlow`)로 계산하며, 화면 편집 대상이 아니다(P1). MusicXML 내보내기는 직렬화만 하면 되므로 온스크린 렌더링 없이도 가능.

### 5.3 음색(Sound) — 지금부터 호환되게

```ts
type Sound =
  | { kind: 'preset'; presetId: string }          // P1: 프리셋 참조
  | { kind: 'patch'; engine: 'synth'|'fm'|'am';   // P2: 커스텀 패치 (스키마만 선반영)
      oscillators: OscillatorSpec[]
      envelope: { attack: number; decay: number; sustain: number; release: number }
      filter?: FilterSpec
      effects: EffectSpec[] }
```

P1에선 `preset`만 사용하지만, 스키마는 풀 패치까지 담을 수 있게 처음부터 둔다 → P2에서 갈아엎지 않는다.

### 5.4 import/export 어댑터

`score-model`은 다음 왕복 변환을 순수 함수로 제공한다:

- **JSON** (정본 직렬화 — 무손실)
- **MIDI** (가져오기/내보내기 — 정본과 거의 1:1)
- **MusicXML** (내보내기 — 양자화 후 기보 변환; 손실 가능, 라운드트립 비대칭 허용)

---

## 6. 아키텍처 / 모듈 경계

```
sculptone/
  pnpm-workspace.yaml
  packages/
    score-model/    # 순수 TS: 모델 타입 + 불변 변환 + import/export. UI/오디오 의존성 0.
    sound-engine/   # Tone.js 위 추상화: Sound(preset/patch) → 재생 그래프. React 의존성 0.
  apps/
    web/
      src/
        app/        # 셸, 모드 탭, 디자인 토큰(CSS 변수), 전역 레이아웃
        state/      # Zustand 스토어 (현재 Project, 선택, 커서, 재생 상태)
        compose/    # 피아노 롤 에디터 (캔버스/SVG 그리드 + 노트 블록)
        play/       # 믹서 + 트랜스포트 뷰
        transcribe/ # P5 스텁 (비활성 탭)
        audio/      # sound-engine 연결, 재생 스케줄링, 재생헤드(RAF)
        midi/       # Web MIDI 입력 → 노트/녹음
        io/         # IndexedDB 저장, 파일 import/export UI
        ui/         # 공통 컴포넌트 (Button, Transport, Slider, Tabs, Badge)
```

**핵심 원칙**
- `score-model`은 UI·오디오를 모른다 (순수·테스트 쉬움). 모든 모듈은 이 모델만 읽고 쓴다.
- `sound-engine`은 React를 모른다 (Tone.js만 의존). 음색 정의 → 재생 그래프 변환 책임.
- **고빈도 핫패스**(피아노 롤 렌더, 재생헤드)는 프레임워크 반응성 바깥에서 명령형(Canvas/SVG + `requestAnimationFrame`)으로 처리. React는 앱 셸(패널·다이얼로그·트랙 목록·인스펙터)을 담당.
- 프론트·향후 백엔드가 `score-model` 타입을 공유(모노레포)한다.

---

## 7. UI 구조 (Design Guide 기준)

- **공유 셸**: 세 모드가 동일 셸(좌 소스 · 중앙 캔버스 · 우 인스펙터 · 상단 툴바 · 하단 트랜스포트)을 쓰고 중앙 캔버스만 교체.
- **① Compose (피아노 롤)**: 좌측 트랙 목록(추가/선택, 트랙별 프리셋 악기), 중앙 그리드 피아노 롤, 우측 인스펙터(선택 노트의 Velocity/Length/Octave). 현재 트랙 노트 = Copper, 그 외 = 그레이. 재생헤드 = Copper 발광선. 툴바에 BPM·박자·Quantize(예: 1/16).
- **② Play (믹서)**: 좌측 트랙별 볼륨 슬라이더, 중앙 재생 영역 + 재생헤드, 하단 트랜스포트. (큰 파형 표시는 폴리시 — 후순위.)
- **③ Transcribe**: P1에서는 **비활성 스텁** ("coming soon"). 디자인은 소스 파형(위) → 생성 악보(아래) 수직 흐름이지만 P5에서 구현.

---

## 8. P1 기능 상세 + 빌드 슬라이스

구현은 아래 순서의 수직 슬라이스로 쌓는다. 각 슬라이스는 독립적으로 동작 가능한 상태를 목표로 한다.

1. **모노레포 + `score-model` 타입/변환** — TDD 단위 테스트(생성/편집/직렬화).
2. **앱 셸 + 디자인 토큰** — 3-모드 탭, 셸 레이아웃, 공통 UI 컴포넌트.
3. **피아노 롤 렌더링(읽기 전용)** — 그리드 + 노트 블록, 현재 트랙 강조, 스크롤/줌.
4. **재생** — `sound-engine`(프리셋 1~2종) + Tone.js, 트랜스포트, 재생헤드(RAF).
5. **피아노 롤 편집** — 노트 그리기/이동/리사이즈/삭제, 양자화, 인스펙터(벨로시티/길이).
6. **멀티 트랙 + 믹서** — 트랙 추가/선택, 트랙별 프리셋 악기, 볼륨/뮤트/솔로.
7. **MIDI 입력** — Web MIDI 연결, 실시간 녹음(양자화) + 스텝 입력, Record(red) UI.
8. **저장/입출력** — IndexedDB 자동저장·불러오기, 내보내기(MIDI/MusicXML/JSON), 가져오기(MIDI).

> **최소 첫 마일스톤(권장)**: 슬라이스 1~5 (단일 트랙 피아노 롤 + 재생 + 편집). 여기서 이미 "만들고 재생"이 되어 데이터 생산이 시작된다. 6~8은 그 위에 확장.

---

## 9. 기술 스택

| 레이어 | 선택 |
|---|---|
| 프론트엔드 | React + TypeScript + Vite |
| 상태관리 | Zustand (불필요 리렌더 회피) |
| 피아노 롤 렌더 | Canvas 또는 SVG + RAF (직접 구현) |
| 스태프 기보(파생/내보내기) | VexFlow 또는 Verovio (MusicXML) |
| 오디오·재생 | Tone.js (Web Audio) |
| 음원(프리셋) | Tone.js Sampler + soundfont, 일부 Tone.js synth |
| MIDI 입력 | Web MIDI API / webmidi.js |
| 저장(P1) | IndexedDB (예: idb 래퍼) |
| 패키지 관리 | pnpm workspaces |
| 테스트 | Vitest (단위/통합) |

향후: 협업 Yjs + Hocuspocus, 백엔드 Node+TS+Postgres(P3), ML Python+PyTorch(P5) — 본 스펙 범위 밖.

---

## 10. 테스트 전략

- **`score-model`**: 순수 함수 → **TDD 단위 테스트** 집중. 편집 변환, 양자화, import/export **왕복 검증**(JSON 무손실, MIDI 라운드트립, MusicXML 직렬화 유효성).
- **`sound-engine`**: 그래프 구성 로직 단위 테스트(오디오 출력 자체는 스모크 수준).
- **apps/web**: 스토어/편집 핸들러 통합 테스트. 피아노 롤 상호작용은 핵심 케이스 위주. 오디오 재생은 스모크.

---

## 11. 리스크 / 열린 질문

- **피아노 롤 ↔ 스태프 기보 양자화**: MusicXML 내보내기 품질은 양자화 정확도에 좌우. P1은 "합리적 기본 양자화" 목표, 정교한 기보 정리는 후속.
- **음원 자산**: 프리셋용 soundfont/샘플 라이선스·용량. P1은 경량 무료 음원 소수로 시작.
- **Web MIDI 브라우저 지원**: Chromium 계열 우선(데스크톱 우선 정책과 합치). Firefox/Safari 제약은 안내로 처리.
- **재생 정확도**: Tone.js Transport 기반 스케줄링의 타이밍 지터 — RAF 재생헤드와 동기화 방식 검증 필요.

---

## 부록 — 결정 로그

- 프레임워크: React + TS + Vite (생태계·예제·협업 UI 강점; 고빈도 렌더는 명령형 분리로 보완).
- 저장 비전: 협업/공유까지(P3) — 단 빌드는 로컬 우선(P1)에서 점진 확장.
- 채보: MIDI 입력 우선 → 오디오 AI 채보는 자체 코퍼스 학습(P5)으로.
- 음색: 프리셋(P1) + 본격 사운드 디자인(P2), 스키마는 P1에서 호환 선반영.
- 정본 모델: **시간 기반(PPQ)** — 피아노 롤·MIDI·AI 코퍼스와 일치. 스태프 기보는 파생.

# Sculptone

브라우저에서 동작하는 음악 창작 도구 — 피아노롤 작곡, 커스텀 신스 사운드 디자인,
멀티트랙 믹싱, MIDI·악보(MusicXML) 입출력을 제공한다.

![CI](https://github.com/wingtgniw/sculptone/actions/workflows/ci.yml/badge.svg)

## 모노레포 구조

- `packages/score-model` — 악보 데이터 모델(Zod 스키마)·직렬화·MIDI/MusicXML 변환. 순수 TS, 프레임워크 무관.
- `packages/sound-engine` — Tone.js 기반 악기/패치를 오디오 그래프로 매핑.
- `apps/web` — React + Zustand UI(피아노롤, 믹서, 사운드 디자인, 악보 뷰).

## 요구 사항

- Node.js >= 20 (`.nvmrc` 참고)
- pnpm 11 — `package.json`의 `packageManager`로 버전 고정. corepack 사용 권장: `corepack enable`

## 시작하기

```bash
pnpm install   # 의존성 설치
pnpm dev       # 웹 개발 서버 (apps/web)
```

## 스크립트 (루트)

| 명령                | 설명                                   |
| ------------------- | -------------------------------------- |
| `pnpm dev`          | 웹 개발 서버                           |
| `pnpm test`         | 전체 패키지 테스트 (Vitest)            |
| `pnpm coverage`     | 커버리지 측정 + 임계값 게이트 (v8)     |
| `pnpm typecheck`    | 전체 패키지 타입 체크 (`tsc --noEmit`) |
| `pnpm build`        | 전체 패키지 빌드                       |
| `pnpm format`       | Prettier 포맷 적용                     |
| `pnpm format:check` | 포맷 검사(변경 없이)                   |

특정 패키지만 실행하려면 필터를 쓴다: `pnpm --filter @sculptone/web test`.

## CI

`.github/workflows/ci.yml` — `main` 푸시와 모든 PR에서 실행한다:

1. pnpm 설치(버전은 `packageManager`에서 인식, 스토어 캐시)
2. `pnpm -r typecheck`
3. `pnpm -r coverage` — 테스트 + 커버리지 임계값 게이트
4. `pnpm -r build`

커버리지 리포트는 워크플로 아티팩트로 업로드된다. 의존성·GitHub Actions 업데이트는
Dependabot이 주간 PR로 제안하며, 위 CI가 각 PR을 검증한다.

## 기술 스택

React 18 · TypeScript · Zustand · Tone.js · Zod · VexFlow · Vite · Vitest · pnpm workspaces

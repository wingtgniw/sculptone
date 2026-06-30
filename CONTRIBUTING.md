# 기여 가이드

## 개발 환경

- Node.js >= 20 (`.nvmrc`)
- pnpm 11 — `corepack enable` 후 `package.json`의 `packageManager` 버전이 자동 사용됨

```bash
pnpm install
pnpm dev      # apps/web 개발 서버
```

## 워크스페이스

pnpm 워크스페이스 모노레포다.

- `packages/score-model` — 데이터 모델·직렬화·변환(순수 TS)
- `packages/sound-engine` — Tone.js 오디오 매핑
- `apps/web` — React UI

패키지 간 의존은 `workspace:*`로 연결되며, `main`/`types`가 소스(`src/index.ts`)를
가리켜 소비 측은 빌드 산출물 없이 소스를 직접 타입체크/번들한다.

## 변경 전 체크

PR/머지 전에 로컬에서 아래가 모두 통과해야 한다(곧 CI가 동일하게 검사):

```bash
pnpm typecheck   # 타입 체크
pnpm coverage    # 테스트 + 커버리지 임계값
pnpm build       # 빌드
pnpm format      # 포맷(적용)  /  pnpm format:check (검사)
pnpm lint        # 린트
```

> 포맷/린트 CI 게이트는 코드베이스 일괄 정리 후 활성화 예정. 그 전까지 `format`/`lint`는
> 로컬 도구로 사용 가능하다.

## 코드 스타일

- Prettier(`.prettierrc.json`): 세미콜론 없음, 작은따옴표, 후행 콤마, printWidth 100
- ESLint(`eslint.config.js`): typescript-eslint 권장 + React Hooks 규칙

## 커밋

- Conventional Commits 형식: `feat(web): ...`, `fix: ...`, `ci: ...`, `chore: ...`, `docs: ...`, `test: ...`
- 한 커밋은 하나의 논리적 변경. 증분이 크면 논리 단위로 나눈다.

## 테스트

- Vitest. 패키지별 `test/` 또는 `src/**/*.test.tsx`.
- 새 동작에는 테스트를 추가하고 커버리지 임계값을 유지한다.

## 의존성

- Dependabot이 주간으로 업데이트 PR을 연다(npm + github-actions).
- 메이저 버전 PR은 파괴적 변경 가능성이 있으니 CI 통과 여부와 변경 로그를 확인하고 머지한다.

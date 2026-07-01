-- Sculptone Cloud Sync — projects table
-- Sub-project B: Cloud Project Sync
-- =============================================================================
-- 적용 방법 (택 1):
--   A. Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣기 → Run
--   B. Supabase CLI: supabase db push (supabase 프로젝트 연결 필요)
-- =============================================================================

create table if not exists public.projects (
  id          text         primary key,
  -- Project.id: crypto.randomUUID() 생성. text로 선언해 형식 유연성 유지.

  owner       uuid         not null references auth.users(id) on delete cascade,
  -- Supabase Auth 사용자 UUID. 계정 삭제 시 cascade 삭제.

  title       text         not null default '',
  -- Project.metadata.title.

  data        jsonb        not null,
  -- serializeProject(project)의 JSON.parse() 결과 객체.
  -- 앱은 JSON.stringify(row.data)를 deserializeProject에 전달해 복원한다.

  updated_at  timestamptz  not null,
  -- Project.metadata.updatedAt (ISO 8601 UTC).
  -- LWW 동기화 기준 타임스탬프. saveProject가 updatedAt을 발급하므로
  -- 앱 자체가 이 값의 단일 진실 소스다.

  created_at  timestamptz  not null default now()
  -- 행 최초 삽입 시각. 앱이 쓰지 않으며 감사 목적.
);

-- RLS 활성화: 정책이 하나도 없으면 모든 행 접근 거부.
alter table public.projects enable row level security;

-- ── RLS 정책: 소유자(owner = auth.uid())만 본인 행에 접근 가능 ────────────────

-- SELECT: 본인 행만 조회
create policy "owner can select own projects"
  on public.projects
  for select
  using (auth.uid() = owner);

-- INSERT: owner = 현재 사용자 강제. 다른 사람 행 사칭 불가.
create policy "owner can insert own projects"
  on public.projects
  for insert
  with check (auth.uid() = owner);

-- UPDATE: 본인 행만 수정 가능 + 수정 후에도 owner = 본인(owner 변경 불가).
create policy "owner can update own projects"
  on public.projects
  for update
  using  (auth.uid() = owner)
  with check (auth.uid() = owner);

-- DELETE: 본인 행만 삭제 가능.
-- 참고: 이번 Sub-project B에서 앱이 deleteCloudProject를 호출하지 않음.
-- 이 정책은 미래 삭제 동기화 기능을 위한 예약.
create policy "owner can delete own projects"
  on public.projects
  for delete
  using (auth.uid() = owner);

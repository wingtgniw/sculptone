-- Sculptone Cloud Share — share_token + RPC
-- Sub-project C: Read-only Project Sharing
-- =============================================================================
-- 적용 방법 (택 1):
--   A. Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣기 → Run
--   B. Supabase CLI: supabase db push (supabase 프로젝트 연결 필요)
--
-- 전제: 0001_projects.sql 이미 적용됨
-- =============================================================================

-- 1. share_token 컬럼 추가
--    nullable: 공유 안 된 프로젝트 (기본값)
--    unique: 동일 토큰으로 두 프로젝트 공유 불가
alter table public.projects
  add column if not exists share_token text unique;

-- 2. security-definer RPC: 정확한 토큰의 행 1개만 반환
--    anon이 직접 테이블 SELECT 없이 토큰 조회만 허용 → enumeration 방지.
--    security definer: 함수 내부는 소유자(postgres) 권한으로 실행.
--    set search_path = public: search_path injection 방지.
--    returns table: owner/share_token/created_at 등 민감 컬럼 제외,
--    anon 뷰어에는 id/title/data/updated_at 만 노출.
create or replace function get_shared_project(p_token text)
returns table(id text, title text, data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select id, title, data, updated_at
  from   public.projects
  where  share_token = p_token
    and  share_token is not null;
$$;

-- 3. 권한 부여: anon 및 authenticated 사용자 모두 이 함수 호출 가능
--    (테이블 직접 SELECT는 여전히 기존 RLS 정책이 제한)
grant execute on function get_shared_project(text) to anon;
grant execute on function get_shared_project(text) to authenticated;

-- !! 경고 !!
-- 아래 정책은 추가하지 않는다. 추가 시 모든 공유 프로젝트 열거 가능(enumeration 취약점).
--
--   create policy "anon can view shared projects"
--     on public.projects
--     for select
--     using (share_token is not null);   -- 절대 추가 금지
--
-- anon 접근은 get_shared_project RPC 함수로만 허용한다.

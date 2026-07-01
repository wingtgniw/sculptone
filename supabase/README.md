# Supabase 설정 가이드

Sculptone Cloud Sync(Sub-project B)를 사용하려면 Supabase 프로젝트에 아래 마이그레이션을 적용해야 합니다.

## 전제 조건

Sub-project A(인증) 설정이 완료되어 있어야 합니다:

- Supabase 프로젝트 생성됨
- Google/GitHub OAuth provider 활성화됨
- `apps/web/.env.local`에 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` 설정됨

## 마이그레이션 적용

### 방법 A: Supabase 대시보드 (권장)

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속
2. 프로젝트 선택 → SQL Editor
3. `supabase/migrations/0001_projects.sql` 파일 내용 복사 → 붙여넣기 → Run

### 방법 B: Supabase CLI

```bash
# supabase CLI 설치 및 로그인 후:
supabase link --project-ref <your-project-ref>
supabase db push
```

## 검증

마이그레이션 적용 후 Supabase 대시보드 → Table Editor → `projects` 테이블이 생성되었는지 확인합니다.
Row Level Security 탭에서 4개 정책(select/insert/update/delete)이 활성화되었는지 확인합니다.

## 스키마 요약

| 컬럼         | 타입               | 설명                                |
| ------------ | ------------------ | ----------------------------------- |
| `id`         | text PK            | Project.id (crypto.randomUUID())    |
| `owner`      | uuid FK→auth.users | 소유자                              |
| `title`      | text               | Project.metadata.title              |
| `data`       | jsonb              | serializeProject() 출력 (JSON 객체) |
| `updated_at` | timestamptz        | Project.metadata.updatedAt          |
| `created_at` | timestamptz        | 행 삽입 시각 (자동)                 |

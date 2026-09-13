-- GitHub Pages는 서버가 없기 때문에 브라우저에서 Supabase를 읽습니다.
-- 절대로 service_role / sb_secret 키를 웹에 넣지 마세요.
-- 이 정책은 anon 사용자가 coach_reports의 daily 행을 읽도록 허용합니다.
-- 즉, 해당 daily 데이터는 공개적으로 조회 가능해집니다.

alter table public.coach_reports enable row level security;

drop policy if exists "github_pages_read_daily_reports" on public.coach_reports;

create policy "github_pages_read_daily_reports"
on public.coach_reports
for select
to anon
using (report_type = 'daily');

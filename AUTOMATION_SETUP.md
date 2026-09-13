# Jackson Running Engine — GitHub Actions 자동화

이 폴더의 내용물을 기존 `jackson-running` 저장소 최상단에 복사한다.

추가되는 핵심 파일:
- `backend/sync_to_supabase.py`
- `backend/build_daily_context.py`
- `backend/claude_coach.py`
- `backend/requirements.txt`
- `.github/workflows/daily-running-engine.yml`

자동 실행 흐름:
1. 매일 07:15 KST에 GitHub Actions 시작
2. 최근 7일 Intervals.icu 데이터를 Supabase에 증분 동기화
3. Analytics V1.1 실행 및 derived_metrics 갱신
4. Claude Coach 실행
5. `coach_reports`의 당일 daily report 갱신
6. GitHub Pages 웹은 Supabase 최신 report를 직접 읽으므로 재배포 불필요

GitHub Repository Secrets에 필요한 값:
- `NEXT_PUBLIC_SUPABASE_URL` — 이미 웹 배포용으로 등록한 값 재사용
- `INTERVALS_API_KEY`
- `INTERVALS_ATHLETE_ID`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Secret/service-role 계열 키. 웹 공개용 키와 다름.
- `ANTHROPIC_API_KEY`

중요:
- `.env` 파일은 GitHub에 올리지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`나 `ANTHROPIC_API_KEY`는 코드에 직접 넣지 않는다.
- `sync_intervals.py`는 참고/수동 백업용이며 Actions에서는 실행하지 않는다. `sync_to_supabase.py`가 수집+적재를 통합 수행한다.
- GitHub Actions 스케줄은 GitHub 사정에 따라 몇 분 정도 지연될 수 있다.

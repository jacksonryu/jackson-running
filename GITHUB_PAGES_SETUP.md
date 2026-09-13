# JACKSON RUNNING ENGINE - GitHub Pages 배포

이 버전은 PC의 로컬 JSON 파일을 읽지 않습니다. GitHub Pages에서 실행되는 브라우저가 Supabase의 최신 daily `coach_reports` 행을 읽습니다.

## 보안상 중요한 점

- `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_...` 키는 절대로 GitHub 저장소/Secrets의 `NEXT_PUBLIC_...` 값으로 넣지 마세요.
- GitHub Pages에는 Supabase의 **publishable/anon key**만 사용합니다.
- `SUPABASE_PUBLIC_READ.sql`을 실행하면 `coach_reports`의 `daily` 행은 anon 읽기가 가능해집니다. 즉 사이트 데이터는 실질적으로 공개 데이터가 됩니다.

## 필요한 GitHub Secrets

Repository → Settings → Secrets and variables → Actions → New repository secret

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Supabase Dashboard → Project Settings / API에서 Project URL과 publishable/anon key를 확인하세요.

## Pages 설정

Repository → Settings → Pages → Build and deployment → Source = `GitHub Actions`

`main` 브랜치에 push하면 `.github/workflows/deploy-pages.yml`이 자동으로 빌드/배포합니다.

배포 주소는 일반적으로:

`https://GITHUB_ID.github.io/REPOSITORY_NAME/`

# JACKSON RUNNING ENGINE — PWA addon

이 폴더의 내용을 `jackson-running` 저장소 루트에 그대로 복사하세요.

추가/교체되는 파일:

- `app/layout.tsx`
- `app/pwa-register.tsx`
- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icon-192.png`
- `public/icon-512.png`
- `public/icon-maskable-512.png`
- `public/apple-touch-icon.png`

`app/page.tsx`는 건드리지 않습니다. 현재 대시보드 UI/데이터 로직은 그대로 유지됩니다.

GitHub Desktop에서 Commit → Push 하면 기존 Pages workflow가 자동 배포합니다. 별도 Daily/UTMB/Peak action은 실행할 필요 없습니다.

배포 후 iPhone에서는 Safari에서 사이트를 열고 공유 버튼 → `홈 화면에 추가`를 선택하세요. 홈 화면 아이콘으로 실행하면 Safari 주소창 없이 standalone 앱처럼 열립니다.

# keys.ryong.com

공식 [ZMK Studio](https://github.com/zmkfirmware/zmk-studio)를 ryong.com CMS 스타일로 꾸미고, 누구나 쓸 수 있는 확장 기능을 더한 버전이에요.

## 원칙

- 들어오면 바로 **키보드 연결 → 키 편집**. 로그인을 먼저 묻지 않아요.
- 로그인(GitHub)은 **확장 기능을 실제로 쓰려는 순간에만** 나와요.
- 회원 데이터베이스가 없어요. 각자의 설정은 각자의 GitHub 저장소에 파일로 남아요.

## 누구나 (로그인 없이)

| 기능 | 내용 |
|---|---|
| 키 편집 | 공식 Studio 기능 그대로 |
| Firmware → Shared | 공용 펌웨어 목록(`public/catalog.json`) — 다운로드, 업데이트 단계 안내, 업데이트 전 키 저장 |
| 키 배치 변경 감지 | Save할 때마다 이 브라우저에 키를 기억 → 다음 연결 때 달라져 있으면 "되돌릴까요?" 제안 |
| Backup | 파일로 받기/복원, 최근 기록(키보드별 5개) |
| Guide | 사용법 |
| 키 이름 | 긴 HID 이름(AC …)을 읽기 쉬운 짧은 이름으로, 키 밖으로 넘치지 않게 |

## GitHub로 로그인한 사람

| 기능 | 내용 |
|---|---|
| Firmware → My keyboards | 자기 zmk-config 저장소의 키보드 등록. 목록은 그 저장소의 `keys-ryong.json`에 저장(`[skip ci]`라 빌드 안 돌림). 비공개 저장소 펌웨어도 다운로드 |
| Combos & Macros | 콤보·매크로·탭댄스를 화면에서 만들고 저장 → 펌웨어 자동 빌드. keymap 옆에 `ryong-behaviors.json`(원본)과 `ryong-behaviors.dtsi`(생성)를 두고 keymap에는 `#include` 한 줄만 추가 |
| 소유자(OWNERS) | 공용 목록 편집, 내 키보드를 공용 목록에 추가 |

## 구조

| 위치 | 내용 |
|---|---|
| `functions/` | Cloudflare Pages Functions — GitHub 로그인, 암호화된 세션 쿠키, GitHub API 대리 호출, 비공개 펌웨어 다운로드 |
| `src/ryong/` | 확장 화면 전부 (`Hub`, `Firmware`, `Backup`, `Guide`, `KeysWatcher`, `SignIn`, `api`, `keyboards`, `behaviors/`) |
| `public/catalog.json` | 공용 펌웨어 목록 |
| `scripts/ryong-build.sh` | 빌드 명령 |
| `scripts/functions/` | functions 타입 검사용 설정 (`npx tsc -p scripts/functions/tsconfig.json`) |

공식 파일은 최소한만 건드렸어요 (`App.tsx`, `AppHeader.tsx`, `AppFooter.tsx`, `ConnectModal.tsx`, `main.tsx`, `Key.tsx`, `Keyboard.tsx`, `HidUsageLabel.tsx`, `index.html`, `tailwind.config.js`, 데스크톱 앱용 워크플로 2개의 실행 조건). `package.json`은 그대로라 공식 업데이트가 대부분 그대로 합쳐져요.

## 보안

- GitHub 토큰은 브라우저 스크립트가 읽을 수 없는 HttpOnly 쿠키 안에 AES-GCM으로 암호화돼 있어요. 서버 저장소 없음.
- 쓰기는 저장소 안의 파일 커밋(git trees/commits/refs, contents)만 허용. 다른 사이트에서 보낸 쓰기 요청은 거부.
- 권한은 GitHub App으로, 사용자가 고른 저장소에만, Contents 읽기/쓰기 + Actions 읽기만.

## 설정 (한 번만)

### 1. GitHub App 만들기
GitHub → Settings → Developer settings → GitHub Apps → New GitHub App

- GitHub App name: `keys-ryong` (주소에 쓰이는 이름 = slug)
- Homepage URL: `https://keys.ryong.com`
- Callback URL: `https://keys.ryong.com/api/auth/callback`
- Expire user authorization tokens: 켜기
- Request user authorization (OAuth) during installation: 켜기
- Webhook → Active: 끄기
- Repository permissions: **Contents: Read and write**, **Actions: Read-only** (Metadata는 자동)
- Where can this GitHub App be installed: **Any account** (동료도 쓰려면)
- 만든 뒤: **Client ID** 확인, **Generate a new client secret**

### 2. Cloudflare Pages 환경 변수
Workers & Pages → keys-ryong → Settings → Variables and Secrets (Production)

| 이름 | 값 | 종류 |
|---|---|---|
| `GITHUB_CLIENT_ID` | GitHub App의 Client ID | Text |
| `GITHUB_CLIENT_SECRET` | 만든 client secret | Secret |
| `GITHUB_APP_SLUG` | `keys-ryong` | Text |
| `SESSION_SECRET` | 40자 이상 아무 무작위 문자열 | Secret |
| `OWNERS` | `hiryong` | Text |

저장 후 Deployments에서 최신 배포를 **Retry deployment** 해야 적용돼요.

## 데스크톱 앱 (블루투스)

맥·윈도우 브라우저는 이미 연결된 키보드를 블루투스로 찾지 못해서, 블루투스 편집은 앱으로 해요.

- 앱 = 공식 Studio 앱 코드(`src-tauri`) + `ryong-app/`. 창은 https://keys.ryong.com 을 열고, 블루투스·USB 연결만 앱이 맡아요. 사이트가 바뀌어도 앱은 다시 받을 필요 없어요.
- keys.ryong.com만 앱의 연결 기능을 쓸 수 있어요(`ryong-app/prepare.mjs`가 빌드 때만 권한을 만듦). 다른 사이트 링크는 기본 브라우저로 열려요.
- `.github/workflows/ryong-app.yml`이 맥(.dmg, 유니버설)·윈도우(.exe) 빌드 → `public/app/`에 올림 → 사이트 Guide의 Desktop app에서 다운로드. 공식 앱 코드가 바뀌면 동기화 워크플로가 다시 빌드시켜요.
- 서명 없음: 맥은 처음 한 번 "개인정보 보호 및 보안 → 그래도 열기", 윈도우는 "추가 정보 → 실행". Apple Developer 계정을 만들면 서명을 붙일 수 있어요.
- 버전은 `ryong-app/tauri.ryong.json`의 `version`.

## 공식 ZMK Studio 업데이트 따라가기

`.github/workflows/ryong-sync-upstream.yml`이 매일 아침 공식 저장소 변경을 합치고, 빌드가 되는지 확인한 뒤 올려요. Cloudflare Pages가 그 커밋을 받아 다시 배포해요. 충돌하거나 빌드가 깨지면 사이트는 그대로 두고 GitHub 이슈로 알려줘요.

공식 업데이트가 `.github/workflows` 파일을 바꾸는 경우에는 GitHub 보안 정책상 자동 반영이 안 돼요. 그때는 이슈가 열리고, 손으로 합쳐야 해요.

## 나중에 할 일

- ryong60 보드가 나오면 펌웨어 화면을 다시 구성해요. ryong60 카드를 크게 맨 위에 두고, 다른 키보드(BT60 V2 등)는 "다른 키보드"로 접어요. 실제 보드를 연결해서 확인하면서 맞춰요.
- 2열 카드 시안은 `firmware-two-columns` 브랜치에 있어요(키보드가 여러 대일 때를 위한 것, main에는 없음).

## 배포 (Cloudflare Pages)

- Build command: `bash scripts/ryong-build.sh`
- Build output directory: `dist`
- Custom domain: `keys.ryong.com`

## 라이선스

ZMK Studio는 Apache-2.0이에요. 화면 아래 "License NOTICE"와 원본 `LICENSE`, `NOTICE` 파일은 그대로 유지해요. Pretendard는 SIL OFL, Geist는 SIL OFL이에요.

# Social Auth 로컬 설정

WHICH의 소셜 로그인 Provider 목표는 Google, X, Instagram입니다. Provider Credential은
브라우저에 노출되지 않도록 Next.js Web BFF의 서버 전용 환경 변수로만 관리합니다.

## 환경 파일 위치

- Repository Root `.env`: PostgreSQL과 Fastify API 설정
- `apps/web/.env.local`: Web BFF와 OAuth Provider Credential
- `.env.example`, `apps/web/.env.example`: Commit 가능한 Key 목록과 설명

Next.js는 `apps/web`을 기준으로 실행되므로 OAuth Credential을 Root `.env`에만 적으면 Web
BFF가 읽지 못합니다.

PowerShell에서 최초 파일을 준비합니다.

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
```

이미 파일이 있다면 덮어쓰지 말고 빠진 Key만 추가합니다. `.env`와 `.env.local`은 Git에서
제외되며 실제 Secret을 Commit하면 안 됩니다.

## 공통 Session Secret

Root `.env`의 `INTERNAL_AUTH_SECRET`과 `apps/web/.env.local`의
`AUTH_INTERNAL_SECRET`은 같은 값이어야 합니다. `AUTH_FLOW_SECRET`은 이 값과 분리된 별도
난수를 사용합니다.

```text
# .env
INTERNAL_AUTH_SECRET=<shared-random-secret>

# apps/web/.env.local
AUTH_INTERNAL_SECRET=<same-shared-random-secret>
AUTH_FLOW_SECRET=<different-random-secret>
```

## Provider별 Callback

Provider Console에는 환경에 맞는 정확한 Callback URL을 등록합니다.

- Google: `http://localhost:3000/api/auth/google/callback`
- X: `http://localhost:3000/api/auth/x/callback`
- Instagram: `http://localhost:3000/api/auth/instagram/callback`

운영에서는 `AUTH_BASE_URL`을 HTTPS 공개 Origin으로 바꾸고 Callback도 같은 Origin으로
등록해야 합니다.

## 현재 구현 상태

- Google: Adapter와 Callback 구현 완료
- X: 환경 변수 자리만 준비됨. Provider Adapter 후속 구현 필요
- Instagram: 환경 변수 자리만 준비됨. Provider Adapter와 Meta App Review 조건 검증 필요

Credential이 없는 Provider는 로그인 가능 상태로 간주하지 않습니다. Access Token은 사용자
식별 요청이 끝난 뒤 보관하지 않는 것을 기본 정책으로 합니다.

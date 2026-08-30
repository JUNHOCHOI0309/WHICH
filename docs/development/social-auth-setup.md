# Social Auth 로컬 설정

WHICH의 소셜 로그인 Provider는 Google, X, 네이버, 카카오입니다. Provider Credential은
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
- Naver: `http://localhost:3000/api/auth/naver/callback`
- Kakao: `http://localhost:3000/api/auth/kakao/callback`

운영에서는 `AUTH_BASE_URL`을 HTTPS 공개 Origin으로 바꾸고 Callback도 같은 Origin으로
등록해야 합니다.

## 현재 구현 상태

- Google: OpenID Connect Adapter와 Callback 구현 완료
- X: OAuth 2.0 Authorization Code + PKCE Adapter와 Callback 구현 완료
- Naver: OpenID Connect Authorization Code + PKCE Adapter와 Callback 구현 완료
- Kakao: OpenID Connect Authorization Code + PKCE Adapter와 Callback 구현 완료, 운영 Credential 설정 대기
- Instagram: 현재 제품 범위에서 제외

TikTok Web Login Kit는 PC·모바일 웹의 Sandbox 테스트용으로 구현되었습니다. Native 로그인과
Production 공개는 아직 보류입니다. 범위와 공개 기준은
[TikTok OAuth 로그인 도입 검토안](../product/tiktok-oauth-login-plan-v1.md)을 확인하세요.

### TikTok Sandbox 테스트

1. 로컬 API DB에 `pnpm --filter @which/api db:migrate`를 적용하고 API를 실행합니다.
   운영 DB가 아닌 테스트용 DB인지 먼저 확인합니다.
2. `apps/web/.env.local`에 Sandbox의 `TIKTOK_OAUTH_CLIENT_KEY`,
   `TIKTOK_OAUTH_CLIENT_SECRET`을 넣습니다. `NEXT_PUBLIC_` 변수로 만들지 않습니다.
3. `AUTH_BASE_URL=https://<현재-HTTPS-터널-호스트>`와
   `FEATURE_TIKTOK_LOGIN_ENABLED=true`를 로컬에만 설정합니다.
4. TikTok Sandbox의 Login Kit Web Redirect URI에
   `https://<현재-HTTPS-터널-호스트>/api/auth/tiktok/callback`을 정확히 등록하고,
   `user.info.basic` Scope와 Target User를 확인한 뒤 Apply changes를 누릅니다.
5. Windows에서 의존성 경로가 `C:\p\which`처럼 저장소 밖에 있으면
   `pnpm --filter @which/web dev:webpack --hostname 127.0.0.1 --port 3000`으로 실행합니다.
   기존 `dev`와 Production `build`는 변경하지 않았습니다.
6. HTTPS 주소의 `/login`에서 TikTok을 누릅니다. 처음 연결하는 TikTok 계정은
   추가 가입 또는 기존 WHICH 이메일·비밀번호 재인증을 거칩니다. TikTok에서 이메일은 받지 않습니다.

- PC에서는 활성 소셜 버튼 아래 중앙, 모바일 웹에서는 한 열의 전체 폭으로 표시합니다.
- Flag OFF, 키 누락, 비 HTTPS origin이면 버튼과 직접 시작·콜백·추가 가입을 차단합니다.
- 앱의 `/mobile-auth` 경로에서는 TikTok을 표시하거나 시작하지 않습니다.
- 터널이 바뀌면 `AUTH_BASE_URL`과 TikTok Redirect URI를 함께 바꾸고 다시 테스트합니다.
- 이 테스트는 로컬 DB를 사용하므로 운영 사이트 계정/기록과 자동으로 공유되지 않습니다.
- 실제 동의 → WHICH 복귀 → 재로그인·게스트 기록 승계를 직접 확인한 뒤 데모를 촬영합니다.
  Sandbox 성공만으로 Production이 승인되지는 않습니다.

Credential이 없는 Provider는 로그인 가능 상태로 간주하지 않습니다. Access Token은 사용자
식별 요청이 끝난 뒤 보관하지 않는 것을 기본 정책으로 합니다.

## X Developer App 설정

X Developer Console에서 OAuth 2.0을 활성화하고 Web App/Confidential Client로 설정합니다.
Callback URL은 위 주소와 정확히 일치해야 합니다. WHICH는 로그인 식별에 필요한 최소 scope인
`users.read tweet.read`만 요청하며 `offline.access`를 요청하지 않으므로 Refresh Token을 저장하지
않습니다. X의 username이 바뀌어도 같은 계정으로 인식할 수 있도록 `/2/users/me`가 반환하는
User ID만 내부 Provider Subject로 사용합니다.

## Naver Developer App 설정

네이버 개발자센터에서 네이버 로그인을 사용하는 Web 애플리케이션을 등록합니다. 개발용과 운영용
애플리케이션 및 Credential은 분리하는 것을 권장합니다.

- 개발 서비스 URL: `http://localhost:3000`
- 개발 Callback: `http://localhost:3000/api/auth/naver/callback`
- 운영 서비스 URL: `https://whichone.site`
- 운영 Callback: `https://whichone.site/api/auth/naver/callback`

WHICH는 네이버의 OIDC Discovery와 Authorization Code + PKCE를 사용합니다. 요청 범위는
`openid profile`이며, 검증된 ID Token의 pairwise `sub`만 Provider Subject로 사용합니다.
표시 이름은 동의받은 `nickname`을 우선하고, 없으면 `name`, 둘 다 없으면 `네이버 회원`을
사용합니다. 네이버 Access Token, Refresh Token, ID Token은 Member Session 생성 후 저장하지
않으며 이메일 주소만으로 기존 계정을 병합하지 않습니다.

네이버 Credential은 다음 서버 전용 환경 변수에 입력합니다.

```text
NAVER_OIDC_CLIENT_ID=<naver-client-id>
NAVER_OIDC_CLIENT_SECRET=<naver-client-secret>
FEATURE_NAVER_LOGIN_ENABLED=false
```

개발이 끝난 뒤 전체 네이버 사용자에게 운영 로그인을 공개하려면 네이버 개발자센터의 사전 검수를
완료해야 합니다. Credential과 검수 전에는 `FEATURE_NAVER_LOGIN_ENABLED=false`를 유지합니다.
이 상태에서는 로그인 UI가 노출되지 않고 Start Route도 `auth=unavailable`로 안전하게 돌아옵니다.
Credential, 운영 Callback, 검수를 모두 확인한 뒤에만 Render와 로컬 환경에서 값을 `true`로
전환합니다. 네이버는 현재 Public Launch Gate의 필수 Provider 검사에는 포함하지 않습니다.

WHICH-20에서 운영 Credential, Callback, 실제 네이버 계정 로그인을 검증했고 WHICH-32부터 Render의
`FEATURE_NAVER_LOGIN_ENABLED=true`를 적용합니다. 네이버 개발자센터의 검수 상태나 제공 정책이
바뀌면 이 Flag를 다시 `false`로 내려 Provider 호출과 UI를 함께 중단할 수 있습니다.

## Kakao Developers App 설정

Kakao Developers에서 Web용 앱을 만들고 다음 순서로 설정합니다.

1. **카카오 로그인 → 사용 설정**을 `ON`으로 전환합니다.
2. **OpenID Connect**를 `ON`으로 전환합니다.
3. REST API 키의 Redirect URI에 아래 Callback을 등록합니다.
4. REST API 키의 Client Secret을 생성하고 활성화합니다.
5. 동의항목은 닉네임을 사용하며 이메일은 필수로 요청하지 않습니다.

- 개발 Callback: `http://localhost:3000/api/auth/kakao/callback`
- 운영 Callback: `https://whichone.site/api/auth/kakao/callback`

서버 전용 환경 변수에는 REST API 키와 Client Secret을 입력합니다.

```text
KAKAO_OIDC_CLIENT_ID=<kakao-rest-api-key>
KAKAO_OIDC_CLIENT_SECRET=<kakao-client-secret>
FEATURE_KAKAO_LOGIN_ENABLED=false
```

WHICH는 Kakao OIDC Issuer `https://kauth.kakao.com`의 Discovery Metadata와 Authorization
Code + PKCE S256을 사용하고 `openid profile_nickname`을 요청합니다. 검증된 ID Token의 `sub`를
Provider Subject로 사용하고 `nickname`을 표시 이름으로 사용합니다. Access·Refresh·ID Token은
저장하지 않으며 이메일로 Google·X·Naver 계정과 자동 병합하지 않습니다.

기존 계정의 표시 이름이 정확히 Provider 기본값(`네이버 회원`, `카카오 회원`, `WHICH 회원`)인
경우에만 다음 해당 Provider 로그인에서 새로 확인한 실제 프로필 이름으로 갱신합니다. 사용자가
직접 설정했거나 기본값과 다른 기존 표시 이름은 로그인만으로 덮어쓰지 않습니다.

Credential 등록과 운영 Callback 실제 계정 QA가 끝날 때까지
`FEATURE_KAKAO_LOGIN_ENABLED=false`를 유지합니다. 이 상태에서는 로그인 버튼이 숨겨지고 Start
Route가 `auth=unavailable`로 돌아옵니다. 실제 QA를 마친 뒤 Render에서 `true`로 바꾸고 재배포합니다.

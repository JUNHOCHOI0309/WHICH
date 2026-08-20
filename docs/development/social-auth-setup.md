# Social Auth 로컬 설정

WHICH의 소셜 로그인 Provider는 Google, X, 네이버입니다. Provider Credential은
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

운영에서는 `AUTH_BASE_URL`을 HTTPS 공개 Origin으로 바꾸고 Callback도 같은 Origin으로
등록해야 합니다.

## 현재 구현 상태

- Google: OpenID Connect Adapter와 Callback 구현 완료
- X: OAuth 2.0 Authorization Code + PKCE Adapter와 Callback 구현 완료
- Naver: OpenID Connect Authorization Code + PKCE Adapter와 Callback 구현 완료
- Instagram: 현재 제품 범위에서 제외

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

WHICH는 네이버의 OIDC Discovery와 Authorization Code + PKCE를 사용합니다. 로그인 식별에는
최소 범위인 `openid`만 요청하고, 검증된 ID Token의 pairwise `sub`만 Provider Subject로
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

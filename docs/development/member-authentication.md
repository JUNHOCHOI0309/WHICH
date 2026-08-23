# Member 중심 인증

WHICH의 사용자 본체는 `members` 한 행입니다. 이메일/비밀번호와 Google, X, 네이버, 카카오는 이 Member에 연결되는 로그인 수단입니다. 제공자마다 별도의 Member를 자동 생성하지 않습니다.

## 신규 사용자 흐름

1. 사용자가 `/login`에서 이메일/비밀번호 또는 소셜 로그인을 선택합니다.
2. 이미 연결된 소셜 identity이면 기존 Member 세션을 생성합니다.
3. 연결되지 않은 소셜 identity이면 Member를 만들지 않고 10분짜리 암호화 가입 쿠키를 발급합니다.
4. `/signup/social`에서 새 WHICH 계정을 만들거나 기존 이메일 계정으로 재인증합니다.
5. 가입이 완료될 때 Member, credential, identity link, Member voter subject와 Guest 기록 승계를 같은 API 트랜잭션에서 처리합니다.
6. 가입 세션은 현재 브라우저에서 유지하지만, 이메일 확인 전에는 새 이메일/비밀번호 로그인 세션을 만들 수 없습니다.

## 기존 소셜 회원 전환

기존 소셜 identity는 계속 로그인할 수 있습니다. 이메일 credential이 없는 회원은 `/me`의 **WHICH 계정 완성** 카드에서 이메일과 비밀번호를 설정할 수 있습니다. 설정 후에도 기존 소셜 로그인은 유지됩니다.

## 데이터와 보안

- `member_credentials.email_normalized`와 `member_id`는 각각 유일합니다.
- 비밀번호는 `@node-rs/argon2`의 Argon2id로 해시하며 평문을 저장하지 않습니다.
- 비밀번호는 15~128자를 허용합니다.
- OAuth 가입 쿠키는 AES-256-GCM으로 인증·암호화하며 HttpOnly, SameSite=Lax, 운영 Secure 속성을 사용합니다.
- 이메일 일치만으로 Member를 자동 병합하지 않습니다. 기존 Member 연결은 이메일/비밀번호 재인증을 요구합니다.
- 기존 OAuth Code + PKCE, state와 OIDC nonce 검증을 유지합니다.
- 이메일 확인 링크는 24시간, 비밀번호 재설정 링크는 30분 동안 한 번만 사용할 수 있습니다.
- 검증·재설정·세션 토큰은 원문 대신 SHA-256 해시만 PostgreSQL에 저장합니다.
- 새 검증·재설정 링크를 발급하면 같은 목적의 이전 링크를 즉시 무효화합니다.
- 비밀번호가 변경되면 기존 Member 세션을 모두 폐기합니다.
- 로그인·가입·메일 요청·토큰 확인 제한은 PostgreSQL 고정 구간 카운터를 사용하므로 여러 앱 인스턴스가 같은 상태를 공유합니다.
- Web BFF는 IP와 이메일/작업 구분자를 `AUTH_FLOW_SECRET` HMAC으로 익명화하고, API는 이 값을 다시 해시해 제한 버킷만 저장합니다.

## 이메일 확인과 계정 복구

- 확인 메일 재요청: `/verify-email`
- 비밀번호 재설정 요청: `/forgot-password`
- 비밀번호 재설정 완료: `/reset-password?token=...`
- API가 발급한 일회용 토큰은 내부 BFF 응답에서만 처리되며 브라우저 JSON과 로그에 포함하지 않습니다.
- 존재하지 않는 이메일의 재설정 요청도 등록된 이메일과 같은 성공 메시지를 반환합니다.
- 운영 발송은 Resend HTTP API를 사용합니다. `RESEND_API_KEY`와 검증된 `AUTH_EMAIL_FROM`이 없으면 메일을 보내지 않으며 토큰을 개발 화면에 노출하지 않습니다.

## 약관과 개인정보

- 서비스 이용약관: `/legal/terms`
- 개인정보 처리방침: `/legal/privacy`
- 가입 동의문과 모든 화면의 공통 Footer에서 두 문서로 이동할 수 있습니다.
- 현재 문서는 베타 운영 초안입니다. 정식 출시 전 실제 운영 주체·연락처·보존 기간·국외 처리 내용을 법률 검토해야 합니다.

## 로컬 확인

```powershell
pnpm infra:up
pnpm --filter @which/api db:migrate
pnpm --filter @which/api dev
pnpm --filter @which/web dev
```

- 통합 로그인: `http://localhost:3000/login`
- 이메일 가입: `http://localhost:3000/signup`
- 소셜 가입: 미연결 소셜 계정으로 OAuth를 완료하면 자동 진입
- 기존 회원 전환: 소셜 로그인 후 `http://localhost:3000/me`

## 운영 설정

- Render에 `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_REPLY_TO`, `SUPPORT_EMAIL`을 설정합니다.
- `AUTH_EMAIL_FROM` 도메인을 Resend에서 먼저 검증합니다.
- 기존 credential에 검증 메일을 보낼 수 있는 상태에서 QA를 마친 뒤 `AUTH_EMAIL_VERIFICATION_REQUIRED=true`로 전환합니다. 초기 배포 값은 기존 회원 잠금을 막기 위해 `false`입니다.
- 배포 후 PC와 Android 인앱 브라우저에서 가입 → 이메일 확인 → 로그아웃 → 이메일 로그인 → 재설정 → 기존 세션 종료를 확인합니다.
- 개인정보 처리방침과 서비스 약관은 정식 공개 전에 법률 검토와 실제 운영자 정보 확정이 필요합니다.
- 기존 중복 Member는 자동 이메일 병합 대신 운영 검토를 거쳐 canonical Member로 정리합니다.

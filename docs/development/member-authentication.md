# Member 중심 인증

WHICH의 사용자 본체는 `members` 한 행입니다. 이메일/비밀번호와 Google, X, 네이버, 카카오는 이 Member에 연결되는 로그인 수단입니다. 제공자마다 별도의 Member를 자동 생성하지 않습니다.

## 신규 사용자 흐름

1. 사용자가 `/login`에서 이메일/비밀번호 또는 소셜 로그인을 선택합니다.
2. 이미 연결된 소셜 identity이면 기존 Member 세션을 생성합니다.
3. 연결되지 않은 소셜 identity이면 Member를 만들지 않고 10분짜리 암호화 가입 쿠키를 발급합니다.
4. `/signup/social`에서 새 WHICH 계정을 만들거나 기존 이메일 계정으로 재인증합니다.
5. 가입이 완료될 때 Member, credential, identity link, Member voter subject와 Guest 기록 승계를 같은 API 트랜잭션에서 처리합니다.

## 기존 소셜 회원 전환

기존 소셜 identity는 계속 로그인할 수 있습니다. 이메일 credential이 없는 회원은 `/me`의 **WHICH 계정 완성** 카드에서 이메일과 비밀번호를 설정할 수 있습니다. 설정 후에도 기존 소셜 로그인은 유지됩니다.

## 데이터와 보안

- `member_credentials.email_normalized`와 `member_id`는 각각 유일합니다.
- 비밀번호는 `@node-rs/argon2`의 Argon2id로 해시하며 평문을 저장하지 않습니다.
- 비밀번호는 15~128자를 허용합니다.
- OAuth 가입 쿠키는 AES-256-GCM으로 인증·암호화하며 HttpOnly, SameSite=Lax, 운영 Secure 속성을 사용합니다.
- 이메일 일치만으로 Member를 자동 병합하지 않습니다. 기존 Member 연결은 이메일/비밀번호 재인증을 요구합니다.
- 기존 OAuth Code + PKCE, state와 OIDC nonce 검증을 유지합니다.

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

## 운영 전 후속 조건

- 이메일 소유권 검증과 비밀번호 재설정 메일 제공자를 결정해야 합니다.
- 분산 환경에서 공유되는 로그인 시도 제한 저장소를 적용해야 합니다.
- 정식 개인정보 처리방침과 서비스 약관은 법률 검토 후 연결해야 합니다.
- 기존 중복 Member는 자동 이메일 병합 대신 운영 검토를 거쳐 canonical Member로 정리합니다.

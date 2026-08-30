# TikTok OAuth 로그인 도입 검토안 v1

- 작성일·공식 문서 확인일: 2026-08-30
- 상태: Web Sandbox 연결 사용자 확인 / 운영 코드 비활성 배포 준비 / Native·Production 로그인 미공개
- 대상: PC Web, Mobile Web, Expo/React Native 앱
- 권장 순서: Sandbox 검증 → Web 공개 요건 충족 → Native 공개 요건 충족

이 문서는 TikTok 로그인 도입 계획과 단계별 구현·공개 조건을 관리한다.
사용자 승인으로 Web Sandbox 구현에 착수했으며, Native와 Production 공개 승인은 별도다.
기존 Google·X·Naver·Kakao·이메일 로그인과 Guest 이용은 그대로 유지한다.

## 2026-08-30 Web Sandbox 구현 기록

- DB/API/Web/Mobile 응답 계약에 `TIKTOK`을 추가했다. Native에는 연결 계정 이름만 표시하며
  로그인 버튼·Provider allowlist는 확장하지 않았다.
- `/api/auth/tiktok/start`, `/api/auth/tiktok/callback`과 Web OAuth Adapter를 구현했다.
  `client_key`, `user.info.basic`, `open_id`를 사용하며 OIDC `id_token`이나 이메일을 가정하지 않는다.
- 서명된 state·10분 TTL·Secure/HttpOnly 쿠키, 고정 HTTPS Callback, Scope와 open_id 일치 검사,
  시간 제한, Provider redirect 거부, 아바타 CDN allowlist, 실패 시 flow 쿠키 삭제를 적용했다.
- 미연결 사용자는 암호화된 가입 Ticket으로 추가 가입/기존 계정 재인증을 진행한다.
  로그인만으로 새 Member를 자동 생성하거나 이메일로 자동 병합하지 않는다.
- 명시적 연결은 시작할 때와 콜백 때 같은 Member 세션인지 확인한다.
- PC 버튼은 기존 소셜 버튼 다음 행 중앙, 모바일 웹에서는 전체 폭이다.
  다른 Provider는 기존 Feature Flag를 그대로 따른다.
- 로컬 Windows의 외부 의존성 경로 때문에 발생한 Turbopack 500을 `dev:webpack`으로 우회했다.
  현재 HTTPS 터널 `/login` 200과 TikTok 로그인 화면 진입을 확인했다.
- 검증: Web 전체 270개, API 계정/승계 통합 24개, Mobile 기존 테스트 38개 통과.
  Web/API 타입 검사와 신규 인증 코드 ESLint 통과. Mobile 타입 검사는 기존 생성된 Expo 경로 타입에
  `/moderation`이 누락되어 실패했으며, 이번 Web OAuth 변경과는 별개다.
- 사용자가 Sandbox 연결 성공과 영상 촬영을 확인했다. 세부 가입·기존 계정 연결·실제 도메인에서의
  재촬영은 별도 QA로 관리한다.
- Access/Refresh Token을 저장하지 않는다. 철회·삭제 이벤트 정책 및 구현, 브랜드/개인정보 검토,
  실제 데모·심사·운영 Credential/Callback 검증은 Production 공개 전 별도 완료해야 한다.
- 운영 통합은 `codex/tiktok-web-login-release`에서 최신 main 위에 TikTok 변경분만 적용한다.
  로컬 초안의 0045 대신 운영 Migration 0052 다음의 `0053_tiktok_identity_provider`와 snapshot을
  새로 생성했다. 기존 데이터 삭제 없이 identity_provider Enum에 TIKTOK만 추가한다.
- 사용자가 코드·DB 변경 커밋과 Render 배포를 승인했다. 이번 배포에서는
  `FEATURE_TIKTOK_LOGIN_ENABLED=false`를 유지하며, 실제 도메인에서의 테스트 활성화는 후속 단계다.
  Render 운영 API에서 가입/연결을 완료하면 Sandbox Credential을 사용하더라도 운영 DB에 저장된다.
- 최신 main 기반 배포 작업본에서 `pnpm check` 전체 통과: Web 285개, API 438개,
  Mobile 39개 테스트 및 lint·typecheck·production build·format 검사.
  Render의 현재 `FEATURE_TIKTOK_LOGIN_ENABLED=false` 설정도 확인했다.

## 1. 목적과 범위

TikTok에서 WHICH로 유입된 사용자가 익숙한 계정으로 로그인하고, Guest 투표·관심사를
자신의 WHICH 계정으로 이어갈 수 있게 한다. 유입 채널과 로그인 Provider는 별도로 측정한다.
TikTok 링크에서 방문했다고 TikTok 로그인을 강제하지 않는다.

### 포함 제안

- `TikTok으로 계속하기` 로그인 버튼과 연결된 로그인 수단 표시
- 기존 Member 로그인, 미연결 identity의 가입 안내, 본인 확인을 거친 기존 계정 연결
- Guest 기록 승계와 로그인 전 화면 복귀
- 닉네임·프로필 이미지의 최소 범위 활용과 기본 이미지 fallback
- 취소·실패·비활성화 Toast, 최근 사용 Provider 확인, 로그아웃·탈퇴 회귀 검증
- PC Web / Mobile Web / Native를 구분한 QA와 공개 상태 관리

### 제외

- TikTok 영상 게시·자동 업로드, 영상 목록·팔로워·좋아요 수 수집
- TikTok Shop, 광고, 콘텐츠 자동 발행, TikTok 계정 자체의 생성·삭제
- 별도 로그인 보상 신설, 기존 W Point·질문 작성 자격 조건 변경
- 로그인 Provider를 근거로 한 취향 추론이나 기존 WHICH 계정 자동 병합

## 2. 공식 요건과 WHICH 설계의 구분

### 인증 방식·최소 데이터

TikTok Login Kit는 OAuth 2.0 기반이다. Google·Kakao의 OIDC 구현을 그대로 복제해
`openid`, ID Token, `sub`, OIDC nonce가 제공된다고 가정하지 않는다.
[공식 Login Kit 개요](https://developers.tiktok.com/docs/en/login-kit-overview)

초기 요청 scope는 `user.info.basic`만 제안한다. User Info의 `open_id`, `display_name`,
`avatar_url`을 사용하며 이메일이 반환된다는 전제를 두지 않는다. `open_id`는 앱 단위 식별자이고,
`union_id`는 같은 개발자의 여러 앱 사이에서 사용하는 식별자다. username과 팔로워 통계는
기본 scope 밖이므로 요청하지 않는다.
[공식 User Info 필드 명세](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info)

### Web 콜백·자동 인증

Web Redirect URI는 사전 등록된 고정 HTTPS 주소여야 하며 쿼리·fragment를 넣을 수 없다.
기존 Provider의 `http://localhost:3000` 예시를 그대로 적용하지 않는다. Web에서 `state`를
검증하고 Client Secret은 서버에만 둔다. `disable_auto_auth=1`은 인증 동의 화면 노출을 위한
옵션이지 계정 선택이나 비밀번호 재입력을 보장하는 옵션은 아니다.
[공식 Web 가이드](https://developers.tiktok.com/doc/login-kit-web)

TikTok Token API의 `code_verifier`는 Mobile·Desktop 경로에서 요구된다. 여기서 Desktop은
네이티브 데스크톱 앱이며 **PC 웹 브라우저는 Web 경로**다. WHICH 앱↔BFF의 PKCE와
TikTok Provider 측 PKCE는 서로 다른 검증 구간으로 취급한다.
[공식 Token API](https://developers.tiktok.com/doc/oauth-user-access-token-management)

### Sandbox와 공개 심사

- Sandbox는 공개 심사 전 제한된 대상 계정으로 검증할 수 있다. 현재 안내상 대상 계정은 최대
  10개이며 운영 공개와 구분한다.
  [공식 Sandbox 안내](https://developers.tiktok.com/docs/en/add-a-sandbox)
- 공개 심사에는 동작하는 서비스, 접근 가능한 약관·개인정보 처리방침, 실제 로그인 과정을
  보여 주는 데모가 필요하다. Native 공개 기준에는 Android의 Google Play 게시와 앱 서명·패키지,
  iOS의 App Store 게시와 Bundle ID가 명시되어 있다. 로컬 APK 설치나 에뮬레이터 QA는 이를
  대체하지 않는다.
  [공식 심사 기준](https://developers.tiktok.com/docs/en/app-review-guidelines)
- 개발자 앱의 플랫폼·URL 소유권 검증·Credential을 환경별로 준비해야 한다. 실제 WHICH의
  TikTok 개발자 계정, 심사 상태, 스토어 게시 여부는 이번 문서 작업에서 확인하지 않았다.
  [공식 앱 등록 안내](https://developers.tiktok.com/docs/en/getting-started-create-an-app)

## 3. 현재 WHICH 구조와 재사용 경계

현재 코드를 기준으로 다음 구조를 재사용한다. 초기 Native Foundation 문서의 Guest-only 단계
설명은 현재 Member 인증 코드의 구현 상태를 대신하지 않는다.

- Web BFF: `apps/web/src/lib/server/member-auth.ts`의 Flow Cookie·가입 Ticket·Provider 검증
- 계정 연결: `apps/web/src/lib/server/member-session-bridge.ts`의 기존 Member/가입 분기
- API: `apps/api/src/modules/identity/`와 `member_identity_links`
- Native: `native-auth.ts`, `native-auth-browser.ts`, Web BFF의 `mobile-auth.ts`
- Native의 현재 반환 주소: `which://auth/callback`; 외부 시스템 브라우저를 사용
- DB: Provider Subject의 유일성과 Member별 Provider 연결 유일성 유지

관련 기준: [Member 중심 인증](../development/member-authentication.md),
[기존 소셜 로그인 설정](../development/social-auth-setup.md).

### Web 인증 흐름 제안

```text
PC Web / Mobile Web
  → /api/auth/tiktok/start
  → TikTok 로그인·동의
  → HTTPS /api/auth/tiktok/callback
  → state 검증 → 서버에서 code 교환 → User Info 검증
  → 이미 연결됨: 기존 Member 세션
    미연결: /signup/social → 신규 가입 또는 기존 계정 재인증·연결
  → Guest 기록 승계 → 원래 Issue 결과 / 내 기록으로 복귀
```

- 내부 Provider 값은 `TIKTOK`, URL·UI용 키는 `tiktok`으로 제안한다.
- Provider Subject는 서버가 검증한 `open_id`를 사용한다. 브라우저가 제출한 ID를 신뢰하지 않는다.
- 같은 환경의 Web·Native는 가능하면 하나의 TikTok 개발자 앱을 공유한다. 별도 Client가
  필요하면 앱별 `open_id` 차이를 먼저 검증하고 식별자 namespace·연결 정책을 재설계한다.
  `union_id`를 사용한 자동 병합이나 무검증 Client 교체는 하지 않는다.
- Sandbox와 Production은 Credential뿐 아니라 Member 데이터도 분리하여 테스트 identity가
  운영 계정에 연결되지 않게 한다.
- 이메일·닉네임·이미지가 같아도 자동 병합하지 않는다. 미연결 계정은 기존 가입 절차에서
  이메일을 직접 입력하거나 기존 WHICH 계정으로 재인증한다.
- 다른 Member에 연결된 TikTok 계정은 이동시키지 않고 충돌 안내를 제공한다.
- 재로그인·연결 재시도 시 Member, 투표 집계, W Point 지급이 중복되지 않아야 한다.

### Native 인증 경로: 구현 전 검증 필요

첫 후보는 기존 `Expo 앱 → 시스템 브라우저 → Web BFF → 일회용 Ticket → 앱 세션 교환`
경로를 재사용하는 것이다. TikTok이 등록·승인한 플랫폼 범위에서 이 방식을 허용하는지 먼저
확인한다. **웹 로그인이 승인되었다는 이유만으로 Native도 공개 가능하다고 판단하지 않는다.**

- Provider Callback은 BFF의 HTTPS 주소, 앱 복귀는 `which://auth/callback`로 구분한다.
  `exp+which-mobile://...` Metro 개발 링크를 TikTok Callback으로 등록하지 않는다.
- 앱 복귀에는 TikTok Token이나 WHICH Session Token 대신 짧은 수명의 일회용 Ticket만 전달한다.
  앱이 보관한 verifier·state·nonce와 결합해 교환하고 재사용을 거부한다.
- TikTok Native Login Kit가 필요하면 별도 경로로 전환한다. 공식 Android 가이드는 HTTPS
  Redirect URI, PKCE, 서버의 code 교환을 안내하므로 기존 custom scheme만으로 대체하지 않는다.
  [공식 Android 가이드](https://developers.tiktok.com/docs/en/login-kit-android-quickstart-v2)
- 시스템 브라우저·JS 변경만으로 가능한 범위는 기존 development client에서 검증한다.
  Native SDK·Manifest·App Link 설정을 추가한다면 로컬 Android 재패키징이 필요하다.
  이번 계획은 EAS 클라우드 빌드나 스토어 제출을 실행하지 않는다.
- Android 에뮬레이터 검증과 실제 휴대폰 검증을 별도로 기록한다. iOS 미검증 상태를 Done으로
  합산하지 않는다.

## 4. 보안·데이터 정책 제안

### 요청·응답 검증

- 암호학적 난수 state와 10분 이내의 Flow 유효기간, HttpOnly·SameSite=Lax Cookie를 사용한다.
  HTTPS 개발 환경에서도 Secure Cookie를 적용하도록 검토한다.
- Callback의 Provider·state·Flow 존재·만료를 확인한 뒤 code를 교환한다. 성공·취소·실패 시
  Flow를 정리하고 Callback 재사용·동시 재시도로 추가 세션/identity가 생기지 않도록 검증한다.
- Token과 User Info의 HTTP 상태 및 오류 본문을 함께 검증한다. `user.info.basic` 승인과
  유효한 `open_id`, Token 응답과 User Info 식별자 일치를 확인한 뒤 세션을 만든다.
- 요청 timeout·크기 제한을 두고, code 교환을 무제한 재시도하지 않는다. 장애·429는 안전한
  오류 안내로 종료한다.
- returnTo는 기존 내부 경로 검증을 거친다. 외부 URL·임의 앱 scheme으로 이동시키지 않는다.
- 인증 code, state, Token, 원본 프로필 응답을 로그·Analytics에 남기지 않는다.
  실패 단계와 정제한 오류 코드만 기록한다.
- OAuth 기반 TikTok Flow와 OIDC Flow의 타입을 구분한다. 기존 공통 `codeVerifier` 필드를
  바꾸더라도 Google·X·Naver·Kakao의 검증을 약화하지 않는다.

### 프로필·Token 보존

- 기본 이름은 `틱톡 회원`으로 제안한다. 사용자가 직접 바꾼 닉네임·아바타·꾸미기 상품은
  재로그인으로 덮어쓰지 않는다.
- 프로필 이미지는 기존 서버 캐시·업로드 경로의 검증을 재사용한다. TikTok CDN host와
  redirect를 검증하고, 내부망 URL·크기 초과·비이미지 응답을 차단한다. 다운로드 실패 시
  기본 아바타로 로그인은 완료한다.
- 초기 로그인 전용 설계에서는 Access·Refresh Token을 사용자 식별 동안만 서버 메모리에서
  사용하고 DB·Cookie·앱 번들에 영구 저장하지 않는 것을 우선 제안한다. 백그라운드 프로필
  동기화나 Refresh 작업은 포함하지 않는다.
- 다만 Token 미보관과 연결 해제 시 Provider 권한 철회는 별개의 문제다. TikTok revoke API는
  Access Token을 요구한다. 장기 Token 미보관 상태에서의 철회 방법(재인증 후 revoke 또는
  TikTok 권한 관리 안내), 보존 정책의 적합성은 공개 전 확정해야 한다. WHICH 로그아웃을
  TikTok 로그아웃·권한 철회로 표현하지 않는다.
  [공식 Token·revoke API](https://developers.tiktok.com/doc/oauth-user-access-token-management)
- TikTok은 `authorization.removed` Webhook을 제공한다. 공개 전에 서명 검증·중복/지연 이벤트
  처리와 identity·프로필·세션 정리 범위를 설계한다. 권한 철회를 WHICH Member 전체 삭제로
  처리하지 않으며, Token 미보관만으로 권한 철회 대응이 끝났다고 보지 않는다.
  [공식 Webhook 이벤트](https://developers.tiktok.com/doc/webhooks-events)
- 개인정보 처리방침의 수집 항목·목적·보존·삭제·외부 전송 내용은 실제 데이터 흐름에 맞춰
  별도 검토한다. 이 문서는 법률 적합성을 판정하거나 운영 방침을 변경하지 않는다.

## 5. 설정·UX 제안

아래 Web 키와 Start/Callback Route는 구현되었다. Native Flag는 후속 단계 제안이며 아직 읽지 않는다.

```dotenv
# apps/web/.env.local 또는 Web BFF 서버 설정에만 저장
TIKTOK_OAUTH_CLIENT_KEY=<environment-specific-client-key>
TIKTOK_OAUTH_CLIENT_SECRET=<server-only-client-secret>
FEATURE_TIKTOK_LOGIN_ENABLED=false
# 후속 Native 단계 제안 (현재는 미지원)
# FEATURE_TIKTOK_NATIVE_LOGIN_ENABLED=false
```

- 제안 운영 Callback: `https://whichone.site/api/auth/tiktok/callback`
- 제안 개발 Callback: `https://<registered-dev-host>/api/auth/tiktok/callback`
- 개발용 공개 HTTPS BFF 주소를 정해 Sandbox에 등록한다. Metro 터널은 JS 번들 서버이므로
  Web BFF의 HTTPS 접근 경로를 대신하지 않는다. 실제 주소 생성·도메인 등록은 별도 승인 후 진행한다.
- 전역 Flag OFF 또는 Credential 누락이면 버튼을 숨기고 Start/Callback도 거부한다.
  Native는 전역 Flag와 Native Flag를 모두 통과해야 한다.
- Native Flag를 UI에서만 검사하지 않는다. Native 시작·완료·Ticket 발급 경로도 서버에서
  검사해 직접 URL 접근으로 공개 제한을 우회할 수 없게 한다.
- Native가 서버의 Provider 가용 상태를 읽는 계약과 최근 사용 Provider fallback도 함께 설계한다.
  오래된 앱의 하드코딩 버튼이나 캐시만으로 사용 가능하다고 판단하지 않는다.
- `TikTok으로 계속하기` 버튼은 기존 로그인 UI와 접근성 규칙을 따르고 공식 브랜드 자산을 사용한다.
- 최근 사용은 바로 자동 실행하지 않고 현재 앱의 계정 확인 단계를 유지한다. Provider 로그인
  상태가 남을 수 있음을 알리고, 다른 계정 사용·브라우저 전환 안내를 제공한다.
- Toast 제안: 성공 `로그인되었습니다.`, 취소 `TikTok 로그인을 취소했어요.`, 실패
  `TikTok 로그인에 실패했어요. 다시 시도해 주세요.`, 비활성화 `현재 TikTok 로그인을 이용할 수 없어요.`

## 6. 구현 작업 분리안

아래는 단계별 작업 범위다. Identity 계약·Web OAuth·Web UX 구현 및 자동 검증은 상단 기록을
따르며, Native와 철회·공개 단계는 미완료다. 기존 WHICH Tasks 번호를 임의로 배정하거나 Done 처리하지 않는다.

| 작업 묶음      | 대상          | 예정 변경                                                                            | 완료 증거                                |
| -------------- | ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| 도입 Gate      | 공통          | 개발자 계정·플랫폼·Sandbox·철회/보존 정책 결정                                       | 설정 체크리스트와 플랫폼별 허용 범위     |
| Identity 계약  | API/DB        | `identity_provider`에 `TIKTOK` 추가, 검증 Schema·계약·아바타 Provider 확장           | Migration + 중복/충돌/승계 통합 테스트   |
| OAuth Adapter  | Web BFF       | `tiktok-oauth.ts`, Start/Callback, Flag·Flow·가입 Ticket·session bridge 확장         | Provider mock·보안·가입 테스트           |
| Web UX         | PC/Mobile Web | 로그인·계정 연결·최근 사용·프로필·Toast                                              | 두 화면 크기의 각각의 실제 계정 QA       |
| Native UX/인증 | Android/iOS   | `NativeAuthProvider`, `MobileAuthProvider`, 세션 계약·가용 Provider·로그인 화면 확장 | 앱 복귀·일회용 Ticket·SecureStore 테스트 |
| 철회·공개      | 공통/플랫폼별 | Webhook·로그아웃/탈퇴 정책, 심사 데모, 운영 문서·Flag 전환                           | 플랫폼별 심사와 수동 QA 기록             |

특히 `apps/api/src/database/schema/enums.ts`, `apps/api/src/modules/identity/routes.ts`,
`apps/web/src/lib/contracts.ts`, `apps/mobile/src/contracts.ts`의 Provider 목록을 함께 점검한다.
DB Enum만 추가하거나 로그인 버튼만 추가한 상태를 기능 완료로 보지 않는다.

## 7. QA·완료 기준

### 공통 자동/통합 검증

- [ ] Flag OFF·키 미설정 상태에서 Provider 요청·직접 Start·Callback·Native 완료가 모두 차단됨
- [ ] state 누락/변조/만료·Provider 혼동·외부 returnTo·code 재전송을 거부함
- [ ] scope 거부·Token 오류·User Info 오류·ID 불일치·timeout·429에서 Member가 생성되지 않음
- [ ] 최초 인증은 가입 또는 명시적 연결로 진행되고, 재로그인은 같은 Member를 사용함
- [ ] 이메일 일치로 자동 병합하지 않고 다른 Member의 TikTok identity를 빼앗지 않음
- [ ] Guest 투표·관심사 승계, 선택 복원, 결과 복귀, 집계·포인트 중복 방지를 유지함
- [ ] 이미지 누락·캐시 실패·직접 수정한 프로필·재실행 후 프로필 유지가 정상임
- [ ] 기존 Provider·이메일 로그인·로그아웃·탈퇴 테스트가 통과함
- [ ] 권한 철회 이벤트의 위조·재전송·지연 수신과 재인증을 검증함

### 플랫폼별 수동 QA — 각각 별도 기록

| 대상                 | 확인할 흐름                                                          | 현재 상태 |
| -------------------- | -------------------------------------------------------------------- | --------- |
| PC Web               | 신규 가입·기존 계정 연결·취소·다른 TikTok 계정 선택·Toast            | 미실행    |
| Mobile Web           | Chrome/Safari의 결과 복귀·하단 내비게이션·작은 화면·키보드           | 미실행    |
| TikTok 인앱 브라우저 | 외부 링크 진입·Cookie 제약·필요 시 외부 브라우저 안내·원래 질문 복귀 | 미실행    |
| Android 에뮬레이터   | development client·시스템 브라우저·Ticket 교환·재실행                | 미실행    |
| Android 실기기       | TikTok 설치/미설치·동의 취소·앱 전환·Cold Start·원래 결과 복귀       | 미실행    |
| iOS 실기기           | 구현 경로 확정 후 시스템 인증 창·Universal Link/앱 복귀·세션 유지    | 미실행    |

Mobile은 추가로 Ticket 탈취 시 verifier 없이 세션을 얻지 못하는지, 같은 Ticket을 두 번 사용할
수 없는지, 로그아웃·탈퇴 후 재실행해도 보호 데이터가 다시 나오지 않는지 검증한다.
이번 문서 작성 자체는 위 QA의 통과 증거가 아니다.

## 8. 공개·보류·롤백 판단

공개 전까지 Web Flag는 OFF가 기본이며, 로컬 Sandbox 테스트에서만 명시적으로 켠다.
Sandbox Credential을 운영에 복사해 전체 사용자에게 공개하지 않는다. Native는 계속 미지원이다.

- **Web 공개 가능:** Sandbox·계정 연결 QA, 데이터 정책, Web 심사, 운영 Callback을 모두 확인함.
- **Native 공개 가능:** Web 공통 검증에 더해 앱 경로의 허용 범위·스토어/서명 요건·해당 OS의
  실기기 QA를 확인함. Web Done과 Native Done을 별도로 기록함.
- **보류:** Native 방식·철회 정책·심사 요건이 불명확하거나 기존 Member 연결 안전성을 보장하지 못함.
  기존 로그인 방식과 Guest 이용은 계속 제공함.
- **롤백:** Flag를 내려 신규 TikTok 인증·연결과 진행 중 Callback/Ticket 발급을 중단함.
  DB Enum·기존 identity를 즉시 삭제하지 않으며, 이미 발급된 WHICH 세션 폐기는 장애·보안 사고의
  성격에 따라 별도 판단함. 대체 로그인 수단이 없는 회원의 복구 안내를 준비함.

다음 단계는 **실제 Sandbox 로그인·계정 연결 QA와 데모 촬영**이다. 이후 권한 철회 정책,
심사와 운영 설정을 완료해야 Web을 공개할 수 있다. Native 방식과 스토어 요건은 별도 결정한다.

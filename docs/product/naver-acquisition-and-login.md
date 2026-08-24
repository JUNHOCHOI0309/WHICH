# 네이버 Acquisition과 로그인 전략 v1

WHICH의 한국 초기 유입은 Instagram 직접 유입보다 네이버의 질문·커뮤니티·콘텐츠 Surface를
우선합니다. 네이버 로그인은 이 유입 채널을 자동 운영하는 권한이 아니라, 투표 후 Guest 기록을
Member 계정에 연결하는 별도의 OpenID Connect(OIDC) 인증 수단입니다.

## 두 경로의 분리

```text
Acquisition
네이버 CHOiCE / 카페 / 클립→블로그 / 홈피드DA
  → UTM이 포함된 WHICH Issue URL
  → 가입 없는 Guest Vote
  → Result → (기능이 켜진 경우 Comment) → Next Issue

Identity
Result 이후 네이버 로그인 선택
  → 네이버 OIDC Authorization Code + PKCE
  → 안정적인 Provider Subject 확인
  → 기존 Guest 선택을 Member에 연결
```

- 유입 Source는 UTM·Referrer와 방문 Event에서 판단합니다.
- 로그인 Provider는 Member Identity Link에만 기록합니다.
- 네이버에서 왔다는 이유로 네이버 로그인을 강제하지 않습니다.
- 네이버 OIDC Access·Refresh·ID Token은 검증 후 저장하지 않습니다.
- 일반 사용자 로그인 Credential에 카페 글쓰기·블로그 발행 권한을 추가하지 않습니다.

## 초기 채널 우선순위

| 채널          | 역할                        | WHICH 연결                                    | 초기 우선순위 |
| ------------- | --------------------------- | --------------------------------------------- | ------------- |
| 지식iN CHOiCE | 질문 반응 검증              | 직접 링크는 채널 정책 확인 후 제한적으로 사용 | 1             |
| 네이버 카페   | 커뮤니티 반응과 유기적 유입 | 특정 Issue 딥링크                             | 1             |
| 네이버 클립   | 짧은 영상 도달              | 클립→블로그→Issue                             | 1             |
| 네이버 블로그 | 검색과 중간 랜딩            | 특정 Issue 딥링크                             | 1             |
| 홈피드DA      | 측정 가능한 유료 유입       | 특정 Issue 직접 랜딩                          | 1             |
| 라운지·오픈톡 | 실시간 주제                 | 정책 확인 후 보조 딥링크                      | 2             |
| BAND          | 관심사 커뮤니티와 재방문    | 보조 딥링크                                   | 3             |

채널 기능과 외부 링크 허용 범위는 실제 집행 직전에 네이버의 최신 운영 정책을 다시 확인합니다.
카페·블로그 게시물은 독립적인 정보 가치를 가져야 하며, 숨은 외부 유도나 기계적 대량 생산,
링크 도배를 금지합니다.

## UTM 계약

```text
utm_source=naver
utm_medium=choice|cafe|clip_blog|blog_search|homefeed_da|lounge|band
utm_campaign=<1~64자의 소문자 영문·숫자·점·밑줄·하이픈>
utm_content=<1~96자의 소문자 영문·숫자·점·밑줄·하이픈>
```

예시:

```url
https://whichone.site/issues/591f2e90-996a-50c5-af46-967dd0793000?utm_source=naver&utm_medium=cafe&utm_campaign=initial_issue_test&utm_content=issue_591f2e90
```

UTM에는 Member ID, Guest ID, 선택값과 같은 개인정보·행동 사실을 넣지 않습니다. 네이버 내부
투표 결과와 WHICH Accepted Vote는 서로 다른 표본이므로 합산하지 않고 비교 지표로만 사용합니다.

### 현재 수집 경계

- Web Proxy가 첫 페이지 `GET`에서 위 계약을 만족하는 Naver UTM만 소문자 형태로 정규화합니다.
- `utm_source`와 `utm_medium`은 필수이며 같은 이름의 파라미터가 중복되면 수집하지 않습니다.
- 허용되지 않은 Medium, 길이 초과, 공백·`@`·한글 등 허용 문자 밖의 값도 수집하지 않습니다.
- 정규화 결과는 `which_entry_attribution`이라는 서명된 First-party HttpOnly Cookie에 30일 동안
  First-touch로 보존합니다. 유효한 기존 값은 이후 링크로 덮어쓰지 않습니다.
- Cookie에는 Source, Medium, 선택적 Campaign·Content, 수집 시각만 포함합니다. Provider Subject,
  Member·Guest 식별자, Vote·Choice, 원문 Referrer는 넣지 않습니다.
- 서명에는 별도 `ATTRIBUTION_COOKIE_SECRET`을 사용할 수 있고, 미설정 시 이미 운영에 필요한
  `AUTH_FLOW_SECRET`을 용도 구분된 HMAC 문맥으로 사용합니다. Secret은 Client에 노출하지 않습니다.
- 현재 Cookie는 유입 문맥의 임시 보존 경계입니다. 분석 Event·Session 저장 구조가 도입되면
  서버가 검증된 값을 Entry Event에 1회 연결하고, 로그인 Provider와 독립된 차원으로 집계합니다.

초기에는 CHOiCE·카페·블로그·클립 게시와 네이버 내부 반응 기록을 운영자가 수동으로 처리합니다.
연령대·성별 비교는 WHICH가 해당 속성을 적법하게 수집하고 최소 표본·비식별 기준을 정하기 전에는
제공하지 않으며, 네이버 로그인을 이유로 이 속성을 추가 수집하지 않습니다.

## 네이버 로그인 계약

- Local Callback: `http://localhost:3000/api/auth/naver/callback`
- Production Callback: `https://whichone.site/api/auth/naver/callback`
- 환경 변수: `NAVER_OIDC_CLIENT_ID`, `NAVER_OIDC_CLIENT_SECRET`
- 요청 범위: `openid profile`로 식별자와 별명만 사용하며 이메일·연령·성별·전화번호를 요청하지 않음
- CSRF·재전송 보호: 서명된 HttpOnly Flow Cookie, `state`, `nonce`, PKCE S256 검증
- 내부 식별자: 검증된 ID Token의 `sub`를 Provider Subject로 사용
- 표시 이름: `nickname` → `name` → `네이버 회원` 순서로 결정하며 기존 기본 이름만 다음 로그인에서 갱신
- Token 정책: Access·Refresh·ID Token을 WHICH DB·로그·Cookie에 저장하지 않음

## 2주 검증안

1. WHICH-19의 LOW 초기 Pack에서 6개를 채널별 후보로 고릅니다.
2. CHOiCE 또는 카페에서 질문 자체의 반응을 먼저 확인합니다.
3. 클립→블로그와 카페 딥링크에 서로 다른 `utm_medium`을 사용합니다.
4. Landing→Vote, Vote→Next Issue, Issues per Session, 5-Vote Completion을 비교합니다.
5. 유료 홈피드DA는 유기적 경로의 Landing→Vote가 확인된 뒤 소액으로 시작합니다.

## 구현 단계

- 현재: 네이버 OIDC Adapter와 Naver UTM 정규화·서명된 First-touch Cookie 추가
- 다음: 검증된 Cookie를 Entry Source 원시 Event·Session에 서버 측으로 1회 연결
- 이후: 네이버 외부 반응을 별도 External Signal로 수집
- 장기: 운영자 검수 후 채널별 문구를 만드는 콘텐츠 보조 도구

네이버 콘텐츠 자동 발행, 네이버 내부 반응 자동 수집, External Signal 기반 추천 반영은 현재 MVP
범위에 포함하지 않습니다.

## 공식 참고 자료

- [네이버 로그인 OIDC 개발가이드](https://developers.naver.com/docs/login/devguide/devguide.md)
- [네이버 로그인 API 명세](https://developers.naver.com/docs/login/api/api.md)
- [네이버 카페 운영·게시물 도움말](https://help.naver.com/service/5622/contents/15342?lang=ko&osType=MOBILE)
- [네이버 검색 품질 관련 도움말](https://help.naver.com/service/5626/contents/22945?lang=ko&osType=COMMONOS)

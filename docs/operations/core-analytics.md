# Core Analytics & Acquisition Attribution v2

WHICH의 핵심 흐름을 PostgreSQL 안에서만 측정합니다. 외부 Analytics SDK, 광고 식별자,
IP, 원본 User-Agent, OAuth Subject, 회원 ID, 선택지 값은 Analytics Session/Event에 저장하지 않습니다.
기기·사용자·진입 경로는 BFF에서 비식별 범주로 축약한 뒤 저장합니다.

## 측정 계약

- Session: 마지막 활동 후 30분이 지나면 새 UUID를 발급합니다. UUID는 서명된 HttpOnly Cookie로만
  유지합니다.
- `ISSUE_VIEWABLE_IMPRESSION`: 질문 카드가 화면에 50% 이상 노출된 상태가 500ms 이어졌을 때 1회
  기록합니다. 단순 페이지 요청이나 Prefetch는 노출로 세지 않습니다.
- `VOTE_SUBMIT`: 사용자가 선택 버튼을 눌러 투표 요청을 시작한 시점입니다. 이 이벤트 성공 여부는
  투표 성공 판정에 사용하지 않습니다.
- `RESULT_VIEW`: 결과 화면이 실제로 렌더링된 시점입니다.
- `NEXT_ISSUE_OPEN`: 다음 질문을 찾은 뒤 이동을 시작한 시점입니다.
- `NEXT_ISSUE_EXHAUSTED`: 다음 질문 버튼을 눌렀지만 후보가 없었던 시점입니다. Next Issue Rate의
  불가능한 분모를 제외하기 위한 보조 이벤트입니다.
- `event_id`: Client가 생성한 UUID를 PK로 사용하여 네트워크 재전송을 멱등 처리합니다.
- Vote 성공: Client 이벤트가 아니라 `votes.integrity_state = 'ACCEPTED'`인 서버 원장만 기준으로
  집계합니다. 테스트 Subject는 제외합니다.

## 공식 지표 Population과 Segment

공식 v2 Funnel은 `traffic_class = PRODUCT`인 Session만 포함합니다. 배포 전 Session과 Context 없는
구형 Client는 `UNCLASSIFIED`, 자동화 User-Agent는 `BOT`으로 분류되어 공식 지표에서 빠집니다.
`is_test_subject = true`인 Vote가 하나라도 연결된 Session도 통째로 제외하여 분모 오염을 막습니다.

- 진입: `HOME / EXTERNAL / DIRECT_ISSUE / NATIVE / UNKNOWN`
- 사용자: `GUEST / MEMBER / UNKNOWN`
- 기기: `MOBILE / TABLET / DESKTOP / UNKNOWN`
- 트래픽: `PRODUCT / TEST / OPERATOR / BOT / UNCLASSIFIED`

Member 여부는 Event 요청 시점에 서명된 Member Session Cookie가 있는지만 보고 분류하며, 같은 Analytics
Session 안에서 로그인하면 해당 Session을 Member로 승격합니다. 회원 ID는 Analytics에 복사하지 않습니다.
기기도 원본 User-Agent를 보존하지 않고 위 네 범주만 저장합니다.

운영자나 수동 QA Browser를 제외해야 할 때만 별도 `ANALYTICS_EXCLUSION_SECRET`을 Web 환경에
설정하고, 요청에 같은 값의 `x-which-analytics-exclusion-secret`과
`x-which-analytics-traffic-class: OPERATOR` 또는 `TEST`를 함께 보냅니다. Secret이 없거나 다르면
일반 Product 요청으로 처리합니다. 이 변수는 Client Bundle에 노출하는 `NEXT_PUBLIC_` 변수가 아닙니다.

## Core Vote 실패 격리

Analytics는 계측용 부가 기능이며 Guest Vote의 선행 조건이 아닙니다. Web BFF는 내부 인증에
`AUTH_INTERNAL_SECRET`을 우선 사용하고, 단일 Render Service에서는 `INTERNAL_AUTH_SECRET`으로
Fallback합니다.

Vote Service는 요청으로 받은 Analytics Session UUID를 그대로 FK에 쓰지 않습니다. 같은 Transaction에서
실제로 존재하는 Session만 확인하고 잠근 뒤 연결합니다. Session이 없거나 앞선 Analytics Event가 실패한
경우 Vote Attempt, Vote, Outbox의 Analytics Session 값은 `null`로 기록하며 투표·집계·결과 Snapshot은
정상 처리합니다. 이 경계 때문에 계측 장애가 Core Vote 500 오류로 전파되지 않습니다.

## 네이버 유입 경계

첫 진입 때 검증하여 서명한 `source`, `medium`, `campaign`, `content`만 Session에 복사합니다.
`source`는 `naver`, `medium`은 WHICH가 허용한 매체 코드만 받을 수 있습니다. OAuth Client ID,
OAuth Subject, 로그인 성공 여부, 투표 선택값은 유입 데이터와 결합하지 않습니다.

## 핵심 Product Loop와 지표 정의

공식 Funnel 순서는 다음과 같습니다.

`Viewable → Submit → Accepted → Result → Next → Second Vote`

- QVPS(Qualified Votes per Session): 유효 서버 투표 수 / Viewable Impression Session 수
- First Vote Conversion: 유효 서버 투표가 1개 이상인 Session 수 / Viewable Impression Session 수
- Second Vote Conversion: 유효 서버 투표가 2개 이상인 Session 수 / Viewable Impression Session 수
- Next Issue Rate: 다음 질문 이동 기회 수 / (결과 조회 기회 수 - 후보 없음 기회 수). 같은 Session에서
  여러 안건을 볼 수 있으므로 Session·Issue 조합을 한 번씩 셉니다.
- Acquisition Channel: UTC 날짜와 `source / medium`별 위 지표 구성 수치. Campaign과 Content는
  원시 Session 진단에는 남지만 공식 Segment 집계 차원을 불필요하게 늘리지 않습니다.
- Submit Rate: Vote Submit Session / Viewable Session
- Acceptance after Submit: Accepted Vote Session / Vote Submit Session
- Result after Accepted: 같은 Session·Issue의 서버 Accepted Vote가 확인된 Result Session /
  Accepted Vote Session

분모가 0이면 비율은 0으로 출력합니다. v2 집계 단위는 UTC 날짜이며 Source/Medium에 더해 진입,
사용자, 기기 Segment를 함께 보존합니다.

## 원장 대조와 공급 지표

`analytics:reconcile`은 Accepted Vote 중 Analytics Session 연결률, 대응하는 `VOTE_SUBMIT`·
`RESULT_VIEW` 누락 수, 종결 Vote가 확인되지 않은 Submit Event를 보여줍니다. 또한 모든
`vote_aggregates.accepted_vote_count`를 Accepted Vote 원장과 대조하여 불일치 안건 수와 절대 표 차이를
출력합니다. Client Event는 성공 판정이 아니라 누락 진단에만 사용합니다.

기준선에는 현재 투표 가능한 안건 수, Category 분포, 조회 0건·투표 0건 안건 수, 상위 1개 안건의
투표 집중도도 포함됩니다. 추천 품질 해석 전에 콘텐츠 공급 부족 여부를 먼저 확인하기 위한 값입니다.

## 운영 명령

```bash
pnpm --filter @which/api analytics:summary -- 30
pnpm --filter @which/api analytics:reconcile -- 30
pnpm --filter @which/api analytics:baseline -- 30
pnpm --filter @which/api analytics:aggregate
pnpm --filter @which/api analytics:retention
```

`summary`는 공식 v2 Funnel과 Segment를, `reconcile`은 Event↔Vote↔Aggregate 대조 결과를 출력합니다.
`baseline`은 두 결과와 공급 지표, 첫 저위험 Experiment 사전등록을 한 JSON으로 묶습니다. 조회 기간은
원시 Event 보존 정책에 맞춰 최대 90일입니다. 첫 배포 뒤에는 새 Context가 붙은 Session만 공식 지표에
들어가므로 초기에 `INSUFFICIENT_DATA`가 정상일 수 있습니다.

`aggregate`는 기존 호환용 비식별 일별 집계를 갱신합니다. `retention`은 집계를 먼저 갱신한 다음 수신
시각 기준 90일이 지난 원시 Event와 더는
참조되지 않는 Session을 삭제합니다. 운영 Scheduler에서는 `analytics:retention`을 하루 1회 실행하면
집계와 보존 기한을 함께 유지할 수 있습니다.

Session 서명은 `ANALYTICS_SESSION_SECRET`을 선택적으로 분리할 수 있습니다. 미설정 시 이미 필요한
`AUTH_FLOW_SECRET`을 별도 HMAC 문맥으로 사용하므로 추가 환경 변수는 필수가 아닙니다.

첫 실험은 `apps/api/content/experiments/which-50-next-issue-cta-v1.json`에 `PLANNED`로만
사전등록되어 있습니다. 최소 7일 및 Arm당 Qualified Session 200개를 모두 충족하기 전에 승자를
선언하지 않으며, 별도 기능 플래그와 QA 없이는 활성화하지 않습니다.

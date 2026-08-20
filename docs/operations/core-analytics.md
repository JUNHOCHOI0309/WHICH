# Core Analytics & Acquisition Attribution v1

WHICH의 핵심 흐름을 PostgreSQL 안에서만 측정합니다. 외부 Analytics SDK, 광고 식별자,
IP, User-Agent, OAuth Subject, 회원 ID, 선택지 값은 Analytics Session/Event에 저장하지 않습니다.

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

## 네이버 유입 경계

첫 진입 때 검증하여 서명한 `source`, `medium`, `campaign`, `content`만 Session에 복사합니다.
`source`는 `naver`, `medium`은 WHICH가 허용한 매체 코드만 받을 수 있습니다. OAuth Client ID,
OAuth Subject, 로그인 성공 여부, 투표 선택값은 유입 데이터와 결합하지 않습니다.

## 지표 정의

- QVPS(Qualified Votes per Session): 유효 서버 투표 수 / Viewable Impression Session 수
- First Vote Conversion: 유효 서버 투표가 1개 이상인 Session 수 / Viewable Impression Session 수
- Second Vote Conversion: 유효 서버 투표가 2개 이상인 Session 수 / Viewable Impression Session 수
- Next Issue Rate: 다음 질문 이동 기회 수 / (결과 조회 기회 수 - 후보 없음 기회 수). 같은 Session에서
  여러 안건을 볼 수 있으므로 Session·Issue 조합을 한 번씩 셉니다.
- Acquisition Channel: UTC 날짜와 `source / medium / campaign / content`별 위 지표 구성 수치

분모가 0이면 비율은 0으로 출력합니다. v1 집계 단위는 UTC 날짜입니다.

## 운영 명령

```bash
pnpm --filter @which/api analytics:summary -- 30
pnpm --filter @which/api analytics:aggregate
pnpm --filter @which/api analytics:retention
```

`summary`는 지정한 최근 일수(기본 30일)를 JSON으로 출력합니다. `aggregate`는 비식별 일별 집계를
갱신합니다. `retention`은 집계를 먼저 갱신한 다음 수신 시각 기준 90일이 지난 원시 Event와 더는
참조되지 않는 Session을 삭제합니다. 운영 Scheduler에서는 `analytics:retention`을 하루 1회 실행하면
집계와 보존 기한을 함께 유지할 수 있습니다.

Session 서명은 `ANALYTICS_SESSION_SECRET`을 선택적으로 분리할 수 있습니다. 미설정 시 이미 필요한
`AUTH_FLOW_SECRET`을 별도 HMAC 문맥으로 사용하므로 추가 환경 변수는 필수가 아닙니다.

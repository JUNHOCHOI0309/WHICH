# ADR-0006: Series·Tournament·Prediction domain boundary

- Status: Accepted for v2 research; Production disabled
- Date: 2026-08-27
- Task: `WHICH-90`
- Supersedes: none
- Extends: [`ADR-0003`](./0003-issue-format-and-media-policy.md)
- Readiness: [`Future format v2 readiness runbook`](../../operations/future-format-v2-readiness.md)

## Context

WHICH의 현재 Issue는 하나의 질문과 고정된 Choice에 한 번 투표하는 상시 취향형 계약이다.
`successor_issue_id`는 편집상 후속 질문 하나를 연결할 수 있지만, 여러 Match의 승자를 모아 다음
Round를 정확히 한 번 생성하거나 외부 사건의 실제 결과를 확정하는 원장이 아니다.

Tournament를 선택지가 많은 Issue로 만들면 Round·진출·종료 상태를 잃는다. Prediction을 일반
Issue에 `vote_close_at`만 추가해 표현하면 인기 선택과 실제 결과가 섞이고, 수정·취소·적중 기록을
감사할 수 없다. 두 형식은 `VS/PICK`의 Choice UI가 아니라 Issue 위에 놓이는 별도 진행 도메인으로
분리해야 한다.

이번 Task는 데이터·상태·제품 경계와 v2 Gate만 확정한다. Production table, scheduler, Route,
Web·Mobile UI 또는 사용자 노출을 만들지 않는다.

## Decision

### 1. 공통 원칙

- Vote의 canonical identity는 계속 `choice_id`다.
- Series와 Prediction은 기존 Issue를 소유하지 않고 참조하는 orchestration domain이다.
- Issue Version과 Choice는 Vote가 시작되면 변경하지 않는다.
- 상태 전이는 append-only event와 idempotency key를 남긴다.
- 자동 진행은 잠긴 Result Snapshot과 사전에 공개된 규칙만 사용한다.
- 운영자는 Vote 수치를 보고 승자를 임의로 선택하거나 실제 결과를 추정하지 않는다.
- 취소·정정 시 기존 Vote를 삭제하거나 과거 결과를 덮어쓰지 않는다.

### 2. Tournament 모델

첫 범위는 8명 또는 16명의 power-of-two single-elimination Tournament다. Bye, 패자부활,
조별리그, 복수 선택과 실시간 대진 변경은 지원하지 않는다.

권장 additive schema:

```text
tournament_series
  series_id
  title
  status                 DRAFT | SCHEDULED | ACTIVE | COMPLETED | VOID | CANCELLED
  bracket_policy_version
  minimum_match_votes
  starts_at
  completed_at
  winner_entry_id

tournament_entries
  entry_id
  series_id
  seed_position
  canonical_label
  rights_reference

tournament_rounds
  round_id
  series_id
  round_number
  status                 WAITING | OPEN | CLOSED | ADVANCED | VOID
  generation_key

tournament_matches
  match_id
  round_id
  bracket_position
  issue_id
  issue_version
  state                  SCHEDULED | VOTING_OPEN | VOTING_CLOSED | ADVANCED | VOID
  locked_snapshot_id
  advancing_choice_id
  advancing_entry_id
  tiebreaker_for_match_id

tournament_match_slots
  match_id
  slot_code              A | B
  entry_id
  choice_id
  source_match_id
  source_advancing_choice_id

tournament_events
  event_id
  series_id
  round_id
  match_id
  action
  policy_version
  idempotency_key
  actor_type
  evidence
  created_at
```

Match의 A/B Choice는 해당 Round에서만 유효하므로 후보의 장기 identity는 `entry_id`다.
`advancing_choice_id`는 어느 Vote 결과가 진출을 만들었는지 보존하고, 다음 Round는 그 Choice가
가리키는 `entry_id`를 사용한다. `source_match_id`와 `source_advancing_choice_id`가 parent Issue와
진출 근거를 명시하므로 기존 단일 `successor_issue_id`를 Tournament 대진에 재사용하지 않는다.

### 3. Round 생성과 종료 규칙

1. Series 게시 전에 Entry, seed, 최소 유효 Vote, Match 기간, 동률·저참여 정책을 잠근다.
2. Round의 모든 Match Issue를 transaction으로 생성하고 `(series, round, bracket_position)`
   generation key를 unique하게 저장한다.
3. Match 마감 후 유효 Vote를 재검증하고 immutable Result Snapshot을 잠근다.
4. 최소 Vote 이상이고 한 Choice가 앞선 경우에만 해당 Choice와 Entry를 `ADVANCED`로 기록한다.
5. 최소 Vote 미달은 사전 고지된 한 번의 고정 연장만 허용한다. 다시 미달이면 Match와 Series를
   `VOID` 후보로 보내며 운영자가 임의 승자를 고르지 않는다.
6. 동률은 별도 tie-breaker Match Issue를 정확히 한 번 생성한다. 재동률이면 Series를 `VOID`
   후보로 보내며 seed나 운영자 선택으로 승자를 만들지 않는다.
7. Round의 모든 Match가 `ADVANCED`일 때만 bracket position 순서의 승자를 두 명씩 묶어 다음
   Round를 생성한다. 수동 재배열은 허용하지 않는다.
8. Final Match가 `ADVANCED`되면 그 Entry를 winner로 저장하고 Series를 `COMPLETED`로 만든다.

실행 가능한 순수 판정은
`apps/api/src/modules/issues/future-format-policy.ts`의 `decideTournamentMatch`와
`planTournamentProgress`에 둔다. 현재 Production writer나 scheduler에는 연결하지 않는다.

### 4. Prediction 모델

Prediction은 외부에서 실제로 발생할 사건을 예측하는 Issue다. 인기 Choice가 실제 결과를 만들지
않으며, 공식 근거를 가진 Resolution이 별도로 존재한다.

```text
predictions
  prediction_id
  issue_id
  issue_version
  status                 DRAFT | OPEN | CLOSED | RESOLUTION_PENDING | RESOLVED | VOID
  closes_at
  resolution_policy_version
  authoritative_source_type

prediction_resolutions
  resolution_id
  prediction_id
  revision
  status                 RESOLVED | VOID
  resolved_choice_id
  void_reason
  source_reference
  resolved_by
  resolved_at
  UNIQUE (prediction_id, revision)
```

- `closes_at`은 첫 유효 Vote 이후 앞당기거나 늦추지 않는다. 잘못된 일정은 Prediction을 VOID하고
  새 Version 또는 새 Prediction을 만든다.
- DB 시간을 사용하는 idempotent close job이 `OPEN -> CLOSED -> RESOLUTION_PENDING`을 만든다.
- `RESOLVED`는 이 Prediction의 정확히 한 Choice와 공식 source reference를 요구한다.
- 취소, 결과 판정 불가, source 무효는 resolved Choice 없이 사유가 있는 `VOID`다.
- 정정은 기존 Resolution을 수정하지 않고 revision을 추가한다.
- 사용자 적중은 accepted Vote와 최신 Resolution에서 `PENDING | HIT | MISS | VOID`로 파생한다.
- Vote 무효화나 Resolution 정정 시 projection을 다시 계산하며 과거 revision을 보존한다.
- 사용자 포인트·보상은 Resolution 안정화와 법률 검토를 거친 별도 결정 전까지 연결하지 않는다.

### 5. 추천·만료·성과 분리

상시 취향 Issue와 Tournament·Prediction을 하나의 점수로 섞지 않는다.

| 영역      | 상시 취향 Issue          | Tournament                      | Prediction                             |
| --------- | ------------------------ | ------------------------------- | -------------------------------------- |
| Retrieval | 관심사·품질·다양성       | 현재 열린 Series·Round          | 마감 전, Resolution SLA가 있는 항목    |
| 만료      | lifecycle 정책           | Round 종료 후 다음 Round로 이동 | `closes_at` 즉시 Vote 제외             |
| 성공      | Vote 전환·결과·다음 질문 | Round 완료율·다음 Round 재방문  | 마감 전 참여·Resolution 확인 재방문    |
| 품질      | 신고·skip·댓글           | 대진 이탈·저참여·진행 실패      | VOID율·Resolution 지연·정정률          |
| 개인 성과 | 취향 기록                | 참여 Round·우승 후보 기록       | HIT/MISS/VOID, 정확도는 충분한 표본 후 |

Prediction의 적중률을 취향 품질이나 추천 정확도로 해석하지 않는다. 종료된 Prediction은 일반
Feed 후보에서 제거하고 결과 확인 Surface에서만 제한적으로 재노출한다. Tournament Match도 현재
열린 Round 외에는 일반 최신 Feed를 점유하지 않는다.

### 6. 정직한 제품 문구

제품은 실제 인과관계에 맞는 표현만 사용한다.

| 상황                | 허용 문구                                   | 금지 문구                                       |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| 일반 취향           | `선택을 남겼어요`                           | `결과를 결정했어요`                             |
| 커뮤니티 Tournament | `참여자 투표 결과로 다음 대진이 생성됩니다` | 실제 반영이 없는데 `당신이 진출자를 결정합니다` |
| Prediction 제출     | `예측을 남겼어요`                           | `결과에 영향을 줬어요`                          |
| Prediction 결과     | `공식 결과 기준으로 적중했어요`             | 인기 Choice를 `정답`으로 표시                   |
| 의견 조사형 후속    | `다음 질문 제작에 참고합니다`               | 자동 반영이 없는데 `다음 질문을 결정합니다`     |

참여 결과가 실제 다음 Round 생성 transaction에 연결될 때만 공동 결정 표현을 쓸 수 있다. 운영
사정으로 결과를 반영하지 못한 경우 해당 Match를 VOID하고 이유를 공개한다.

### 7. Vertical별 정책 의존성

- 정치·시사: 조작·선거·허위정보·여론조사 표시와 국가별 법률 검토 전까지 비지원
- 실제 인물: 명예훼손·괴롭힘·외모 비교·개인정보·미성년자 정책과 신고 SLA 필요
- 스포츠: 공식 결과 source, 일정 변경·취소 규칙과 데이터·상표 사용 권리 필요
- 팬덤 IP: 후보명·이미지·로고·영상의 저작권·상표·퍼블리시티권 근거 필요
- 금융·도박성 예측: 보상·확률·미성년자·관할 법률 검토 전까지 비지원

첫 Pilot은 `LOW_RISK_ORIGINAL` Tournament 또는 공식 결과와 데이터 권리가 확보된
`SPORTS_WITH_LICENSED_DATA`만 후보가 될 수 있다. 정치·시사, 실제 인물과 권리 미확보 팬덤 IP는
v2 첫 Pilot에서 제외한다.

### 8. v2 Go/No-Go

다음 최소 증거가 없으면 `INSUFFICIENT_EVIDENCE`이며 구현과 사용자 노출을 시작하지 않는다.

- Public v0가 30일 이상 안정적으로 운영됨
- PICK의 Go/No-Go 결정이 끝나 동시에 두 횡단 migration을 진행하지 않음
- 최소 10명의 비공개 prototype 연구와 수요 근거가 문서화됨
- Tournament는 3개 전체 대진 Dry Run, Prediction은 30개 Resolution fixture 검증

증거가 있어도 다음 중 하나면 `NO_GO`다.

- 최근 30일 Sev-1 안전·무결성 사건
- Tournament 불가능한 상태 전이 또는 generation replay 불일치 1건 이상
- Prediction Resolution 감사 실패 또는 SLA를 넘긴 미해결 fixture 1건 이상
- 정직한 제품 문구 또는 Vertical 정책 미승인
- 정치·시사, 실제 인물, 권리 미확보 팬덤 IP를 첫 Pilot으로 선택

모든 조건을 통과한 `GO`는 하나의 형식에 대한 내부 Vertical Slice 시작만 허용한다. Public 노출은
별도 schema migration, scheduler, Ops QA, Web·Mobile capability와 제한 실험 Task가 필요하다.
판정 코드는 `evaluateFutureFormatV2Gate`에 둔다.

### 9. Feature flag와 Rollback

후속 server modes는 다음처럼 형식별로 분리한다.

```text
ISSUE_TOURNAMENT_MODE=OFF|INTERNAL|PILOT
ISSUE_PREDICTION_MODE=OFF|INTERNAL|PILOT
```

기본값은 모두 `OFF`다. Client 환경값만으로 형식을 열 수 없다. Rollback은 신규 Round 생성과
Prediction 제출을 중단하되 Series, Match, Resolution, Vote와 event 원장을 삭제하지 않는다.
열린 Prediction은 사전 고지에 따라 마감·해결하거나 VOID하고, 열린 Tournament는 Round를 마친
뒤 중단하거나 근거를 남겨 Series를 VOID한다.

## Consequences

- Tournament 후보 identity와 Match Choice, 다음 Round 생성 근거를 분리해 감사할 수 있다.
- Prediction의 인기 결과와 실제 결과, 정정·VOID를 혼동하지 않는다.
- scheduler, authoritative source와 운영 SLA라는 새로운 비용이 생긴다.
- 기존 Issue/Vote 원장을 재사용하지만 상위 상태와 projection table이 추가된다.
- v2 전까지 Production 동작, 사용자 UI와 공개 API는 바뀌지 않는다.

## Rejected alternatives

- Tournament를 5개 이상 PICK으로 표현: Round·진출·재방문 상태가 없다.
- 다음 Match Issue를 `successor_issue_id`만으로 연결: 여러 parent Match와 bracket slot을 표현하지
  못한다.
- 동률을 seed·랜덤·운영자 선택으로 해소: 투표가 만든 승자라는 약속을 위반한다.
- Prediction의 다수 Choice를 정답으로 사용: 외부 실제 결과와 커뮤니티 인기를 혼동한다.
- Resolution row를 제자리 수정: 정정과 운영자 판단의 감사 이력을 잃는다.

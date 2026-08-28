# Community Reporting and Enforcement Policy v1

- Status: design baseline — current content controls implemented, account sanctions remain backlog
- Last updated: 2026-08-28
- Scope: Comment, Reply, Thread, Issue, Profile, Member, and Report abuse
- AI roadmap: [`ai-moderator-implementation-roadmap.md`](./ai-moderator-implementation-roadmap.md)
- Governance baseline:
  [`09_MODERATION_AND_GOVERNANCE_v2.md`](../../WHICH_PLANNING_V2_REVISIONS/09_MODERATION_AND_GOVERNANCE_v2.md)
- Public v0 boundary: [`public-v0-release-scope.md`](./public-v0-release-scope.md)

## Decision

WHICH는 정상 사용자의 댓글 수와 답글 깊이를 제한하는 방식으로 커뮤니티 위험을 줄이지 않는다.
동일 Issue에 여러 최상위 댓글을 쓸 수 있고, 답글은 깊이 제한 없이 이어질 수 있다. 대신 실제
피해 행동에는 콘텐츠, Thread, 기능, 계정 순서로 범위를 넓히는 증거 기반 제재를 적용한다.

```text
open participation
  -> report and deterministic safety signals
  -> reversible content containment
  -> human or calibrated policy decision
  -> scoped feature restriction for repeated violations
  -> account restriction only for serious or persistent harm
  -> notice, appeal, complete restoration, and audit
```

신고는 판결이 아니라 검토 신호다. 신고 수, 싫어요 수, A/B Choice, 의견의 비인기, 댓글 작성량은
그 자체로 Strike나 계정 제재를 만들지 않는다. 영구 삭제, 장기 정지, 계정 종료는 사람의 결정을
요구한다.

## Goals and non-goals

### Goals

- 정상적인 반복 댓글과 깊은 대화를 막지 않고 괴롭힘, Spam, 개인정보 노출을 빠르게 제한한다.
- 하나의 문제 댓글 때문에 계정 전체를 즉시 막지 않고 피해 범위에 맞는 최소 조치를 선택한다.
- 반복 위반은 콘텐츠별 독립 사건으로 흩어 두지 않고 Member 단위 Enforcement 이력으로 연결한다.
- 조직적 신고가 자동 삭제나 계정 제재를 유도하지 못하게 한다.
- 모든 조치를 되돌릴 수 있고, Appeal 인용 시 노출·권한·파생 상태를 완전하게 복구한다.
- 1인 운영자가 P0 사건과 반복 위반을 먼저 볼 수 있도록 Queue를 우선순위화한다.

### Non-goals

- 반대 의견, 불쾌함, 낮은 공감 수를 정책 위반으로 취급하지 않는다.
- 공개 Profile에 Strike 숫자나 신고 횟수를 표시하지 않는다.
- 참여 포인트, Badge, 인기, 소셜 Provider 수로 신고 가중치나 제재 면제를 구매하게 하지 않는다.
- AI 판정 하나로 콘텐츠를 영구 삭제하거나 계정을 영구 정지하지 않는다.
- Threshold를 사용자 UI에 상세 공개해 우회 기준으로 제공하지 않는다.

## Current production baseline

현재 배포 코드의 실제 동작과 향후 정책을 구분한다.

| 영역           | 현재 동작                                                                 |
| -------------- | ------------------------------------------------------------------------- |
| 작성 자격      | 해당 Issue Version의 `ACCEPTED` Vote와 유효한 Member session 필요         |
| 대화 구조      | Member별 최상위 댓글 개수 제한 없음, 답글 깊이 제한 없음                  |
| 신고 자격      | 해당 Issue의 유효 Vote를 가진 Guest 또는 Member                           |
| 중복 방지      | 같은 Subject가 같은 댓글을 두 번 신고할 수 없음                           |
| 자기 신고      | 작성자는 자기 댓글을 신고할 수 없음                                       |
| 일일 제한      | Subject당 Comment 신고 20건/24시간                                        |
| 현재 가중치    | Guest 1점, Member 2점                                                     |
| 자동 접기      | 유효 10점 이상이면서 서로 다른 신고자 5명 이상                            |
| 자동 숨김      | 유효 20점 이상이면서 서로 다른 신고자 10명 이상                           |
| 자동 숨김 결과 | `HIDDEN + PENDING_HUMAN_REVIEW + REVIEW`; 삭제가 아님                     |
| 운영자 결정    | `COLLAPSE`, `HIDE`, `REMOVE_POLICY`, `RESTORE`와 append-only 이력         |
| 복구 안전장치  | 복구 시 현재 신고 점수를 baseline으로 고정해 과거 신고의 즉시 재적용 방지 |

현재 구현의 한계:

- 신고 사유는 `SPAM`, `HARASSMENT`, `HATE_OR_ABUSE`, `PERSONAL_INFORMATION`, `OTHER`만 지원한다.
- Guest/Member 고정 가중치는 신고 정확도와 조직적 신고 가능성을 반영하지 못한다.
- 자동 접기·숨김은 댓글 단위 조치이며 반복 위반자의 작성 권한과 연결되지 않는다.
- Thread Slow Mode, Member Cooldown, Premoderation, Appeal 사용자 화면은 아직 없다.
- 신고 클러스터, 외부 유입 Burst, 동일 Campaign과 무효 신고 비율을 계산하지 않는다.

따라서 현재 임계치를 더 낮추는 것은 제재 강화가 아니라 오탐과 좌표찍기 위험을 높일 수 있다.
다음 단계는 신고 수를 늘리는 것이 아니라 증거 품질과 반복 위반 연결을 강화하는 것이다.

## Policy taxonomy

### Canonical Comment and Reply reasons

| Canonical code         | 사용자 의미                    | 현재 API mapping       | 기본 Queue                       |
| ---------------------- | ------------------------------ | ---------------------- | -------------------------------- |
| `SPAM`                 | 도배·광고·반복·악성 링크       | `SPAM`                 | `SPAM_MANIPULATION`              |
| `INSULT_OR_HARASSMENT` | 욕설·비방·표적 괴롭힘          | `HARASSMENT`           | `COMMENT_ABUSE`                  |
| `HATE`                 | 보호 대상 혐오·차별·비인간화   | `HATE_OR_ABUSE`        | `COMMENT_ABUSE`                  |
| `THREAT`               | 구체적 위협·폭력 조장          | `OTHER` + detail       | `VIOLENCE_THREAT`                |
| `PRIVACY`              | 개인정보·Doxxing·사생활 침해   | `PERSONAL_INFORMATION` | `PRIVACY_DOXXING`                |
| `SEXUAL`               | 성적 괴롭힘·착취·비동의 콘텐츠 | `OTHER` + detail       | `SEXUAL_EXPLOITATION`            |
| `IMPERSONATION`        | 사칭·공식 계정 위조            | `OTHER` + detail       | `COMMENT_ABUSE`                  |
| `ILLEGAL_ACTIVITY`     | 사기·불법 행위 조장            | `OTHER` + detail       | `CRITICAL_SAFETY` 또는 일반 검수 |
| `COORDINATED_ABUSE`    | 집단 공격·신고 조작·우회       | `OTHER` + detail       | `SPAM_MANIPULATION`              |
| `OTHER`                | 위 범주로 설명하기 어려움      | `OTHER`                | `COMMENT_ABUSE`                  |

Reason 확장은 기존 값을 즉시 제거하는 마이그레이션이 아니라 canonical mapping을 추가한 뒤 Client를
순차 전환한다. `싫어요`는 콘텐츠 선호 반응이며 Report Reason이나 Strike Evidence가 아니다.

### Severity

| 등급            | 의미                     | 예시                                          | 기본 처리                                      |
| --------------- | ------------------------ | --------------------------------------------- | ---------------------------------------------- |
| `S0_CLEAR`      | 위반 아님                | 반대 의견, 정중한 비판, 단순 비인기           | 유지; 악성 신고 후보 분리                      |
| `S1_DISRUPTIVE` | 경미한 질서·품질 훼손    | 의미 없는 반복, 가벼운 비꼼, 저강도 Spam      | Nudge, Deprioritize 또는 Collapse 후보         |
| `S2_HARMFUL`    | 명확한 정책 위반         | 반복 모욕, 표적 괴롭힘, 상업 Spam             | Hide/Remove 검토와 반복 위반 기록              |
| `S3_SEVERE`     | 높은 피해 가능성         | 혐오 선동, 신상 일부 노출, 구체성이 낮은 위협 | 즉시 가역 격리와 P0/P1 검수                    |
| `S4_CRITICAL`   | 긴급·불법·회복 곤란 피해 | 구체적 폭력 위협, Doxxing, 아동 착취, 피싱    | 즉시 격리, 증거 보존, Senior/Legal/Safety 판단 |

Severity는 의견의 강도나 신고 수가 아니라 피해, 표적성, 반복성, 도달 범위와 긴급성으로 정한다.
Confidence는 별도 필드로 유지하며, 낮은 Confidence의 중대 가능성은 `ALLOW`가 아니라
`HIDE_PENDING_REVIEW`로 라우팅할 수 있다.

## Enforcement ladder

제재는 가능한 한 작은 범위에서 시작한다. 콘텐츠 조치와 계정 조치는 분리하며, 자동화는 가역적인
초기 단계에만 권한을 가진다.

| 단계                  | 범위          | Action 예시                                              | 자동화 경계                                |
| --------------------- | ------------- | -------------------------------------------------------- | ------------------------------------------ |
| `E0_ALLOW`            | 없음          | 유지, 신고 기각                                          | 규칙 또는 사람                             |
| `E1_INFORM`           | 사용자        | 작성 전 Nudge, Notice, Warning                           | 가능                                       |
| `E2_REDUCE`           | 콘텐츠        | Deprioritize, Collapse, 대표 댓글 제외                   | 가능; 즉시 복구 가능                       |
| `E3_CONTAIN`          | 콘텐츠·Thread | Hide pending review, Slow Mode, Thread Lock              | 명백한 규칙·보정된 신호에 한해 가역 자동화 |
| `E4_RESTRICT_FEATURE` | 기능          | Comment Cooldown, Comment Premoderation, Issue 작성 제한 | 짧은 기간만 제한 자동화 후보; 장기는 사람  |
| `E5_RESTRICT_ACCOUNT` | 계정          | Read-only, Temporary Suspension                          | 사람 승인 필수                             |
| `E6_TERMINATE`        | 계정·법률     | Termination, Legal removal                               | Senior/Legal 사람 결정 필수                |

적용 원칙:

1. 첫 경미 위반은 계정 정지보다 콘텐츠 조치와 정책 안내를 우선한다.
2. 동일 정책의 반복, 제재 우회, 다수 Target 공격은 Feature 범위를 넓힌다.
3. 단일 `S4_CRITICAL` 사건은 누적 점수 없이 강한 긴급 조치가 가능하다.
4. 신고 임계치만으로 가능한 최대 자동 조치는 `E3_CONTAIN`이다.
5. 자동 조치에는 TTL, Policy Version, Kill Switch와 원상 복구 절차가 필수다.
6. A/B Side, Creator 인기, Member 가입 경로에 따라 다른 정책을 적용하지 않는다.

## Internal policy-event ledger

공개 Strike 숫자 대신 확인된 위반과 조치를 append-only `policy_event`로 기록한다. Raw Report는
`policy_event`가 아니며, 사람 판정 또는 출시 Gate를 통과한 결정론적 규칙 결과만 누적한다.

필수 필드:

```text
policy_event_id
member_id
target_type
target_id
policy_code
severity
confidence
source: RULE | MODEL_ASSISTED_HUMAN | HUMAN
action_code
policy_version
content_version_id
occurred_at
expires_at
appeal_status
reversed_by_event_id
evidence_reference
```

### Initial risk-point candidate

위험 점수는 운영 우선순위와 제한 후보를 계산하는 내부 파생값이다. 원본 사건을 대체하지 않는다.

| Severity        | 후보 점수 |            기본 만료 후보 |
| --------------- | --------: | ------------------------: |
| `S1_DISRUPTIVE` |         1 |                      30일 |
| `S2_HARMFUL`    |         3 |                      90일 |
| `S3_SEVERE`     |         6 |                     180일 |
| `S4_CRITICAL`   | 점수 우회 | 사람의 명시적 재검토 시점 |

초기 Feature 제한 후보:

| 유효 점수 | 제안 조치                                        | 승인 경계                                 |
| --------: | ------------------------------------------------ | ----------------------------------------- |
|       0–2 | 콘텐츠 조치와 Notice만                           | 자동 또는 사람                            |
|       3–5 | Comment Cooldown 최대 1시간                      | 반복 Spam처럼 결정론적인 범주만 자동 후보 |
|       6–8 | Comment Cooldown 최대 24시간 + 7일 Premoderation | Phase 3 Gate 전에는 사람 승인             |
|      9–11 | Community Write 7일 제한                         | 사람 승인                                 |
|   12 이상 | Read-only 최대 30일 검토                         | 사람 승인; 자동 금지                      |

이 숫자는 구현 확정값이 아니라 Shadow 평가용 초기안이다. 실제 공개 전 다음을 만족해야 한다.

- 최소 30일의 실제 신고·판정·Appeal 표본으로 재현한다.
- 정책·언어·신규 사용자·A/B Side별 False Positive를 확인한다.
- Appeal 인용 시 사건 점수와 모든 파생 제한을 즉시 다시 계산한다.
- 오랜 무위반 기간에는 만료·감쇠하고, 인기가 낮다는 이유로 위험도가 증가하지 않는다.
- 영구 정지는 점수와 무관하게 사람의 독립 판단을 요구한다.

## Reporter reliability and brigading defense

신고자 신뢰도는 계정 인기나 가입 기간이 아니라 과거 신고의 정확성으로만 계산한다.

### Signals

- 운영 판정으로 확인된 신고 비율
- Appeal에서 뒤집힌 신고 비율
- 같은 Target·문구·시간창·유입 Campaign에 집중된 Report Cluster
- Guest→Member 연결 후 중복 Subject 여부
- 유효 Vote, 계정 탈취·자동화 Challenge와 Rate Limit 결과
- 특정 A/B Side만 반복 공격하는 비정상 패턴

### Rules

- 동일 Subject의 중복 신고는 하나만 집계한다.
- 하나의 Report Cluster가 자동 조치 점수를 독점하지 못하도록 cluster contribution을 제한한다.
- `S3/S4` 가능성이 있는 개인정보·위협 신고는 낮은 Reporter reliability만으로 폐기하지 않는다.
- 신고 남용은 Target 위반 사건과 별도의 `REPORT_ABUSE` Case로 처리한다.
- 신고 권한 Cooldown 중에도 긴급 안전 신고 경로는 제공하되 Challenge 또는 사람 Queue를 사용한다.
- Reporter reliability는 공개하지 않고 추천·투표 가중치·Badge에 사용하지 않는다.

현재의 Guest 1점/Member 2점 가중치는 v0 호환 기준으로 유지한다. Reliability 모델은 먼저 Shadow로
계산하고, 조직적 신고 오탐과 실제 Queue 절감이 확인된 뒤에만 집계 가중치에 반영한다.

## Thread-level safety

무한 답글은 댓글 하나의 Hide만으로 해결되지 않는 상황을 만든다. Thread 조치는 삭제와 분리한다.

| 상황                               | 조치 후보                                  |
| ---------------------------------- | ------------------------------------------ |
| 짧은 시간의 대량 답글              | 30초 또는 60초 Slow Mode                   |
| 두 사용자의 반복 상호 공격         | 해당 Branch Collapse, 상호 Reply 제한 후보 |
| 다수 사용자의 집중 공격            | Thread 전체 `NO_REPLIES` 또는 `FULL_LOCK`  |
| Issue 자체가 오해를 유발           | 댓글보다 Issue 검수·추천 제외를 우선       |
| 작성자 삭제 후 깊은 답글 존재      | Placeholder 유지, 자식 Thread 보존         |
| 정책 삭제 댓글 아래 정상 답글 존재 | 원문 Placeholder와 정상 답글 보존 후보     |

현재 DB에는 `OPEN | LOCKED`만 존재한다. `READ_ONLY`, `NO_NEW_TOP_LEVEL`, `NO_REPLIES`,
`FULL_LOCK`의 세분화는 별도 migration과 API 계약을 필요로 한다.

## Case priority and solo-operator SLA

SLA는 공개 보장이 아니라 1인 운영을 위한 내부 목표다. Queue가 목표를 넘으면 자동화 범위를
넓히는 대신 신규 고위험 기능을 중지하고 가역적인 기본 제한을 유지한다.

| Priority | 예                                          | 자동 기본 상태                  | 사람 확인 목표 |
| -------- | ------------------------------------------- | ------------------------------- | -------------: |
| `P0`     | Doxxing, 구체적 위협, 아동·성적 착취, 피싱  | 즉시 Quarantine, 공유·추천 제외 |     4시간 이내 |
| `P1`     | 혐오, 반복 괴롭힘, 대규모 Spam, 조직적 신고 | Hide/Collapse pending review    |    24시간 이내 |
| `P2`     | 경미한 모욕, 문맥 의존, 품질성 신고         | 공개 또는 Collapse 유지         |    72시간 이내 |
| `P3`     | 신고 기각 후보, 정책 질문, 중복 Case        | Batch 검토                      |       7일 이내 |

P0 oldest age가 4시간을 넘거나 P1 Backlog가 운영 Capacity를 초과하면:

1. AI 자동 삭제를 켜지 않는다.
2. 직접 이미지 업로드·고위험 사용자 Issue 작성 같은 신규 공격면을 중지한다.
3. 해당 범주의 가역 Quarantine과 Thread Lock을 유지한다.
4. Incident를 선언하고 영향을 받은 Target, Rule, Policy Version을 보존한다.

## Notice, appeal, and restoration

`E2`보다 강한 조치에는 가능한 범위에서 다음을 사용자에게 제공한다.

- 대상 콘텐츠와 적용 정책 범주
- 조치가 자동인지 사람 결정인지
- 현재 상태와 시작·종료 시점
- 수정 또는 재참여 조건
- Appeal 가능 여부와 제출 기한
- 결과 통지 예상 시점

Appeal 인용은 단순히 댓글을 다시 보이게 하는 것으로 끝나지 않는다.

```text
content visibility restore
  + policy event reversal
  + effective risk score recalculation
  + feature/account restriction removal
  + ranking/highlight eligibility rebuild
  + notification and audit completion
```

신고자 신원, 내부 Detection Threshold와 보안 우회에 사용될 Evidence는 대상 사용자에게 공개하지
않는다. 권리 요청과 법적 보존은 일반 Appeal 보존 기간과 분리한다.

## Metrics and guardrails

### Safety and enforcement

- Policy별 Confirmed Violation Rate
- Repeat Violation Rate: 30/90/180일
- Content Action → Feature Action 전환율
- Time to Containment와 Time to Human Decision
- Appeal Rate, Appeal Overturn Rate, Restoration Completeness
- 자동 조치 Precision과 잘못된 Hide 지속 시간

### Healthy community

- 댓글 작성자당 정상 최상위 댓글 수
- Constructive Reply Rate와 깊이별 대화 지속률
- 신규 Member의 첫 댓글 성공률
- Thread Lock·Slow Mode 비율
- 신고·제재 증가와 함께 정상 댓글·답글이 과도하게 감소하지 않는지
- A/B Side별 Report, Collapse, Remove, Appeal Overturn 격차

### Report abuse

- Duplicate·Clustered·Invalid Report Rate
- Report Cluster당 유효 Contributor 수
- 조직적 신고로 인한 잘못된 Collapse/Hide
- Reporter Cooldown 이후 긴급 신고 누락 여부
- Guest/Member별 신고 Precision과 Challenge 실패율

다음 중 하나가 발생하면 자동화 확대를 중지한다.

- 특정 A/B Side나 신규 사용자 Slice의 오탐이 기준보다 유의미하게 높다.
- Appeal Overturn이 연속 두 평가 Window에서 악화된다.
- P0 중대한 False Negative가 확인된다.
- 정상 댓글 작성률이 안전 개선보다 더 크게 하락한다.
- Report Cluster 하나가 자동 Hide의 주된 원인이 된다.
- 복구가 콘텐츠·권한·Ranking 중 하나라도 누락한다.

## Data and API backlog

권장 데이터 객체:

```text
moderation_cases
moderation_case_targets
moderation_evidence
policy_events
enforcement_actions
member_feature_restrictions
report_clusters
reporter_reliability_snapshots
user_notices
moderation_appeals
restoration_runs
```

기존 `comment_reports`, `comment_moderation_decisions`, Comment 상태와 Outbox는 유지한다. 신규
객체는 이를 덮어쓰는 별도 진실 원장이 아니라 여러 Target과 Member 이력을 연결하는 상위 Case 및
Enforcement 원장이다.

필수 API/운영 Surface:

- Ops Case 목록: Priority, oldest age, Target, evidence, prior policy events
- 결정: Action scope, duration, reason, policy version, notice, appeal eligibility
- Member 제한 조회: 현재 유효 제한과 만료 시점만 최소 공개
- Appeal 제출·검토·인용·기각
- Restoration dry-run과 apply 결과
- Report Cluster와 reliability Shadow 비교
- Kill Switch: auto collapse, auto hide, short cooldown을 독립적으로 중단

## Rollout and existing task mapping

새 Task ID를 임의로 만들지 않고 기존 AI Moderator Backlog에 연결한다.

| Phase          | 기존 Task   | 결과                                                               |
| -------------- | ----------- | ------------------------------------------------------------------ |
| 0. 정책 기준   | `WHICH-91`  | Taxonomy, Severity, Enforcement ladder, Reason mapping 확정        |
| 0. 신고 방어   | `WHICH-92`  | Subject dedupe, Report Cluster, reliability Shadow, 신고 남용 Case |
| 0. 증거        | `WHICH-93`  | Comment/Reply immutable version과 판정 재현                        |
| 0. 데이터      | `WHICH-94`  | Case, policy event, enforcement action, restriction 모델           |
| 0. 운영        | `WHICH-95`  | Ops actor, decision audit, Queue priority와 SLA                    |
| 0. 복구        | `WHICH-96`  | Notice, Appeal, restoration completeness                           |
| 1. 규칙 Shadow | `WHICH-98`  | Spam burst, PII, link, repeat-pattern 규칙과 Rate Limit            |
| 1. 평가        | `WHICH-100` | 한국어 Comment/Reply와 Report abuse Golden Set                     |
| 2. 검수 보조   | `WHICH-102` | AI evidence와 이전 위반을 보여 주되 사람 결정 유지                 |
| 3. 제한 자동화 | `WHICH-103` | E1–E3 및 검증된 1시간 Cooldown만 Feature Flag로 공개               |
| 3. 감쇠        | `WHICH-110` | Capability 제한, policy-event 만료, risk decay                     |
| 4. 검증        | `WHICH-111` | Side·신규 사용자·Guest·깊은 Reply Slice Random Audit               |

권장 순서:

```text
WHICH-91
  -> WHICH-92 + WHICH-93
  -> WHICH-94 + WHICH-95 + WHICH-96
  -> WHICH-98 + WHICH-100 in shadow
  -> WHICH-102 reviewer assist
  -> WHICH-103 limited reversible enforcement
  -> WHICH-110 decay and capability hardening
  -> WHICH-111 go/no-go
```

## Acceptance scenarios

1. 같은 Member가 한 Issue에 정상 최상위 댓글 여러 개를 작성해도 제재 신호가 생기지 않는다.
2. 5단계 이상의 답글도 같은 정책과 신고·수정·삭제 권한으로 처리된다.
3. 한 Report Cluster의 다수 신고가 단독으로 계정 제한을 만들지 않는다.
4. 자동 Hide는 삭제가 아니며 운영자가 원문, 신고와 Policy Version을 확인할 수 있다.
5. 복구된 댓글은 이전 신고 baseline 때문에 즉시 다시 숨겨지지 않는다.
6. 반복 Spam의 짧은 Cooldown과 괴롭힘의 사람 판정을 서로 다른 정책으로 처리한다.
7. Doxxing 신고는 Reporter 신뢰도가 낮아도 P0 검토에서 누락되지 않는다.
8. 신고가 기각돼도 신고 대상자의 A/B Choice와 Reporter 신원이 서로 노출되지 않는다.
9. Appeal 인용 시 댓글, 작성 권한과 Ranking 파생 상태가 함께 복구된다.
10. Kill Switch를 켜도 신고 접수와 사람 검수 Queue는 계속 작동한다.

## Release gate

Account 또는 24시간 초과 Feature 제한을 공개하기 전 다음이 필요하다.

- Reason·Severity·Action별 Golden Set과 사람 기준선
- 최소 30일 Shadow 결과와 Side·신규 사용자 Slice 비교
- 조직적 신고 시뮬레이션과 정상 Viral 구분 QA
- 사용자 Notice, Appeal, full restoration E2E
- Ops Queue oldest age와 P0 fallback rehearsal
- Feature Flag, Kill Switch, rollback 및 policy-version pinning
- 제한 전후의 정상 댓글·답글 참여 Guardrail
- 영구 조치가 자동 경로에 존재하지 않는지 코드·권한 검증

이 Gate 이전에는 현재의 댓글 단위 자동 접기·숨김과 사람 복원만 운영 제재의 상한으로 유지한다.

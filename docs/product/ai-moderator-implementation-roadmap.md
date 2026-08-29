# AI Moderator Implementation Roadmap

- Status: v2 backlog — exception-first image moderation and assisted enforcement
- Last updated: 2026-08-28
- Notion plan: [WHICH AI Moderator 구현 계획 v2 — 예외 중심 Moderation](https://app.notion.com/p/3c828b27a559818d9d2bd597065b6086)
- Canonical policy: [`moderation-policy-registry-v1.md`](./moderation-policy-registry-v1.md)
- Notion image review: [WHICH 이미지 Moderation 운영 전략 v2](https://app.notion.com/p/3c928b27a5598189aa9bef1335295840)
- Image operations: [`image-moderation-operating-strategy-v2.md`](../operations/image-moderation-operating-strategy-v2.md)
- Related AI roadmap: [WHICH v1 Fine-tuned AI 적용 후보](https://app.notion.com/p/3c628b27a55981c48216e6d292de7eae)
- Related product roadmap: [`post-v0-discovery-recommendation-ai-roadmap.md`](./post-v0-discovery-recommendation-ai-roadmap.md)
- Community enforcement policy: [`community-enforcement-policy-v1.md`](./community-enforcement-policy-v1.md)

## 문서 목적

이 문서는 `WHICH_AI_MODERATOR_ARCHITECTURE_v1.md`와
`WHICH_IMAGE_MODERATION_OPERATING_STRATEGY_v1.md` 검토 결과를 WHICH의 현재 코드와 운영
환경에 맞게 재구성한 구현 경계와 Backlog를 저장소에 보관한다. 목표는 운영자를 없애는 것이
아니라, 검수 대상 자체를 줄이고 자동화가 확신하지 못하는 예외만 사람에게 보내면서 되돌릴 수
없는 결정을 사람에게 남기는 것이다.

## 결론

WHICH에 AI Moderator를 적용할 수 있다. 다만 사용자 이미지 기능의 첫 선행 조건은 AI가 아니라
게시 경로 분리, 결정론적 검사, 제한 Capability, 신고·소명과 운영 지표다. 첫 AI 출시 형태도
자율 운영자가 아니라 다음 역할을 수행하는 운영 보조 시스템이어야 한다.

- 명백한 규칙 위반과 반복 Spam을 저비용 규칙으로 선별한다.
- 애매한 콘텐츠만 AI 분류기에 보낸다.
- 판정 근거와 원문 Version을 운영 Queue에 정리한다.
- 자동 조치는 Nudge, 노출 제한, 되돌릴 수 있는 격리와 짧은 Cooldown으로 제한한다.
- 삭제, 장기 계정 제한, 이의 제기, 권리 침해와 Vote 무효화는 사람이 확정한다.
- Text-only와 승인 Library는 AI 장애와 무관하게 사용할 수 있게 한다.
- 직접 업로드는 비공개 처리 후 예외 Queue로 보내고, 충분히 검증된 저위험 범주만 임시 공개한다.

## 현재 재사용 가능한 기반

- 댓글의 publication, visibility, integrity 상태축과 신고·자동 숨김·복원 흐름
- append-only Moderation 결정 이력
- Vote integrity와 result integrity 상태
- Transactional outbox, 재시도와 DLQ 계약
- `/ops` 운영 콘솔, OPERATOR 권한과 Audit Log
- User Issue 작성·게시 흐름과 Editorial 승인 기반
- R2 staging/published 격리, WebP 정규화, SHA-256/dHash와 이미지 결정·Rights 이력
- `ISSUE_IMAGE_UPLOAD` 후보 판정과 제한 Pilot 운영 계약
- 동일 Issue의 복수 최상위 댓글과 깊이 제한 없는 Reply Thread

## 구현 전에 막아야 할 위험

1. 신고 누적 점수만으로 숨김이 결정되면 조직적 신고가 자동 조치를 유도할 수 있다.
2. 내부 Moderation API가 공용 Secret만 사용하면 누가 결정을 내렸는지 남지 않는다.
3. 댓글 수정이 원문을 덮어쓰면 AI 판정 당시 콘텐츠와 현재 콘텐츠를 재현할 수 없다.
4. 사용자 통지, 사유, 이의 제기와 복원 절차가 없으면 자동화 범위를 넓힐 수 없다.
5. 외부 AI에 보낼 필드, 보관 기간, 재학습 사용 여부와 삭제 절차가 정해져 있지 않다.
6. 1인 운영 중 P0 Queue가 장시간 방치될 때 사용할 안전한 fallback이 없다.
7. 이미지 안전·개인정보·권리·관련성·A/B 시각 편향을 한 점수로 합치면 자동화 경계를 검증할 수 없다.
8. 30개 Pilot 표본은 UX와 Queue 작동만 확인할 뿐 자동 공개 안전성을 입증하지 못한다.
9. Member 업로드가 mode·capability·동의·quota를 서버에서 강제하지 않으면 제한 Pilot을 우회한다.
10. 댓글 수나 Reply 깊이를 다시 제한해 안전 문제를 우회하면 정상 참여를 막으면서 반복 위반자와
    신고 공격은 놓친다.

## 목표 아키텍처

```text
Text-only / approved library
  -> existing immediate publication path

Direct image submission
  -> private one-time upload session
  -> file normalization / rule / rate limit / OCR / local PII screening
  -> immutable content version + MODERATION_REQUESTED outbox
  -> shadow worker
  -> generic safety classifier
  -> ambiguous cases only: policy-aware LLM
  -> deterministic decision engine
  -> private reject / review / provisional publish / quarantine
  -> Ops case + user notice + appeal
```

현재 단계에서는 별도 Microservice 군이나 Redis를 도입하지 않는다. 기존 TypeScript 모듈러
모놀리스, PostgreSQL과 outbox를 확장하고, 부하와 장애 격리 필요성이 측정된 뒤 Moderation
Worker만 별도 Render Service로 분리한다.

## 상태와 기록 원칙

- 모든 판정은 `content_version_id`, 정책 Version, 모델 Version과 입력 Hash를 참조한다.
- AI 출력은 권고이며 코드의 Decision Engine이 최종 허용 조치를 결정한다.
- 동일 콘텐츠와 동일 정책·모델 조합은 Idempotent하게 처리한다.
- 사용자에게 영향을 주는 조치는 Actor, Reason Code, Evidence, 이전·이후 상태를 Audit에 남긴다.
- 댓글·Issue·프로필·이미지는 공통 Case 개념을 사용하되 각 도메인 상태축을 덮어쓰지 않는다.
- 이미지의 technical security, content safety, privacy, rights, relevance, visual fairness를 독립
  Signal로 저장한다.
- 안전 모델 통과가 권리 상태 `CLEARED`를 만들지 않으며, 알 수 없음은 안전으로 취급하지 않는다.

## 자동화 권한 경계

### AI가 자동으로 수행할 수 있는 작업

- 작성 전 표현 수정 Nudge
- Feed 노출 제한 또는 댓글 접기
- 검토 전까지 되돌릴 수 있는 Quarantine
- 짧고 제한된 반복 Spam Cooldown
- 운영자 Queue의 우선순위와 근거 요약
- 검증된 저위험 범주의 임시 공개와 층화 Random Audit. 단, 별도 Release Gate 통과 후에만 허용

### 사람 승인이 필요한 작업

- 정책 위반 영구 삭제
- 하루를 초과하는 계정 제한 또는 영구 정지
- 사용자 이의 제기 판정
- 명예훼손, 개인정보, 저작권 등 권리 요청
- 유효 Vote 무효화와 결과 정정
- 고위험 이미지의 최종 승인·반려
- 개인정보·저작권·명예훼손·미성년·신원과 실존 인물의 최종 판단

## 단계별 출시

### Phase 0 — 정책·권리·감사 기반

- 정책 Taxonomy와 Action Matrix
- 조직적 신고 방어와 신고자 신뢰도
- immutable Content Version
- Moderation Run, Case, Action과 운영자 Identity
- 사용자 통지, 이의 제기와 복원
- 외부 AI Privacy, Provider와 Retention 계약
- 이미지 업로드 session, capability, consent, quota와 fail-closed 계약
- 이미지의 규칙·OCR·QR·PII Signal과 예외 Queue

### Phase 1 — Shadow Mode

- 규칙·Rate Limit·로컬 PII Screening
- outbox 기반 비동기 Worker
- 한국어 Golden Set과 Slice별 평가
- Generic Safety Classifier를 조치 없이 운영
- Text와 Image 평가셋·Adapter·지원 Label을 분리해 운영

### Phase 2 — Reviewer Assist

- Ops Queue에서 AI Label, Confidence, Evidence와 제안 조치 표시
- 사람의 승인·수정·반려 결과를 평가 데이터로 축적
- Queue 시간, 운영자 시간과 Appeal Overturn 측정

### Phase 3 — 제한 자동화

- 높은 Precision이 확인된 Nudge, Limit와 Quarantine만 자동화
- Kill Switch, deterministic fallback, 비용·지연 Budget 적용
- Random Audit와 Slice별 회귀 검증
- 직접 업로드의 임시 공개는 허용된 저위험 cohort와 asset type에만 적용

### Phase 4 — 확장 평가

- 사용자 Issue Moderation
- Policy LLM 또는 Fine-tuning 도입 판단
- Vote Fraud 신호 보조
- 프로필·계정 위험도와 Cooldown

## 평가 기준

단일 정확도나 임의의 95% 목표를 사용하지 않는다. Label과 Action별로 다음을 측정한다.

- Precision, Recall과 치명적 False Negative
- 언어·길이·주제·신규 사용자 등 Worst Slice
- Appeal Overturn Rate와 복원 시간
- Queue oldest age, P0 SLA와 운영자 처리 시간/1,000건
- 자동 조치 후 신고·이탈·재위반 변화
- AI 비용/1,000건, Provider 오류율과 p95 지연
- Shadow와 실제 운영의 분포 변화
- 모델 간 불일치·Abstain·운영자 Override 방향과 검수 시간
- 이미지 게시 후 신고율·권리 요청률·CDN 격리 성공률과 자동화 Coverage

## Privacy와 외부 Provider 원칙

- 외부 AI 호출 전에 이메일, OAuth Subject, IP, Device 식별자와 직접 식별 정보를 제거한다.
- 사용자의 Vote Choice와 원시 세션 정보는 Moderation 입력에 넣지 않는다.
- Prompt와 원문 전체를 일반 Application Log에 기록하지 않는다.
- 입력, 출력, Case Evidence의 보관 기간을 각각 정한다.
- Provider의 학습 미사용, Subprocessor, 지역, 삭제와 DPA 조건을 검토한다.
- 권리 요청과 계정 삭제가 Moderation Evidence 보존 정책과 충돌하지 않도록 예외를 문서화한다.
- 이미지 원본은 비공개·짧은 TTL로 다루고, EXIF를 제거한 축소 정규화본만 승인된 Provider에 보낸다.
- 얼굴 존재는 검토 Signal로 쓸 수 있지만 얼굴 인식·신원 추정·생체 Embedding은 저장하지 않는다.
- Provider별 지역, 재위탁, 학습 미사용, 삭제 전파와 이미지·OCR·Evidence별 보존기간을 숫자로 고정한다.

## 비용이 추가되는 지점

| 비용 항목              | 발생 시점                      | 통제 방법                                      |
| ---------------------- | ------------------------------ | ---------------------------------------------- |
| AI API 호출            | Shadow Mode부터                | 규칙 선처리, 애매한 Case만 LLM, 호출 Budget    |
| 별도 Render Worker     | API와 장애·부하를 분리할 때    | 초기에는 기존 Process, 지표 확인 후 분리       |
| PostgreSQL·Log 저장    | Version, Run, Case, Audit 증가 | Retention, Partition/Archive, 원문 중복 방지   |
| 이미지 Moderation·OCR  | 이미지 Issue Pilot             | 운영자 이미지부터 제한, Hash 재사용            |
| R2 저장·변환·삭제 운영 | 이미지 Evidence 보관           | Published 변형과 보존 기간 분리                |
| Alerting·관측          | 제한 자동화 전                 | 핵심 SLO부터 도입, 고카디널리티 Log 제한       |
| Fine-tuning·평가       | 충분한 Label 이후              | Generic/Policy Prompt 기준선보다 유의미할 때만 |
| 법률·Privacy 검토      | 외부 Provider·권리 처리        | Provider 계약과 Retention 확정 전 호출 금지    |
| 대체 운영 인력         | P0 대응 보장 시                | On-call 경계와 비상 연락망을 작게 설계         |

초기 Phase 0는 대부분 기존 인프라에서 진행할 수 있다. 가장 큰 초기 고정비는 별도 Worker이며,
가장 큰 변동비는 AI 호출과 이미지 검사다.

## Notion Backlog

댓글·답글 제재는 [`community-enforcement-policy-v1.md`](./community-enforcement-policy-v1.md)를
실행 기준으로 사용한다. Raw Report, 싫어요, 댓글 작성량은 Strike가 아니며, 확인된 위반만
`policy_event`로 누적한다. `WHICH-91`–`WHICH-103`, `WHICH-110`, `WHICH-111`은 AI 모델 도입
Task이기 전에 신고 방어·Case·Appeal·가역 제재 기반을 완성하는 Workstream이다.

| Task      | Priority | 목적                                                                            |
| --------- | -------- | ------------------------------------------------------------------------------- |
| WHICH-91  | P0       | 정책 Taxonomy·Severity·Enforcement Matrix 확정                                  |
| WHICH-92  | P0       | 신고 Cluster·Brigading 방어와 신고자 신뢰도 Shadow                              |
| WHICH-93  | P0       | 수정 가능한 콘텐츠 Version·재검수 계약                                          |
| WHICH-94  | P0       | Moderation Case·Policy Event·Enforcement 데이터 모델                            |
| WHICH-95  | P0       | Ops Queue·SLA·Actor Identity·Decision Audit                                     |
| WHICH-96  | P0       | 사용자 통지·이의 제기·완전 복원·권리 처리                                       |
| WHICH-97  | P0       | AI Privacy·Provider·Retention 정책                                              |
| WHICH-98  | P0       | 규칙·Rate Limit·로컬 PII Screening                                              |
| WHICH-99  | P1       | Outbox 기반 Shadow Moderation Worker                                            |
| WHICH-100 | P1       | 한국어 Golden Set·Slice·Evaluation Harness                                      |
| WHICH-101 | P1       | Generic Safety Classifier Shadow Mode — adapter/gate implemented, rollout OFF   |
| WHICH-102 | P1       | Ops Reviewer Assist UI와 Decision Capture — 구현 완료, 운영 배포·표본 검증 대기 |
| WHICH-103 | P1       | Decision Engine과 가역적 E1–E3 제한 자동화                                      |
| WHICH-104 | P1       | Fallback·Cost Budget·Observability                                              |
| WHICH-105 | P1       | 사용자 Issue 3경로와 비동기 검수 UX                                             |
| WHICH-106 | P3       | Policy LLM·Fine-tuning 도입 평가                                                |
| WHICH-107 | P2       | Vote Fraud 보조 신호와 검증                                                     |
| WHICH-108 | P1       | 이미지 Rule·OCR/QR·Safety Shadow Gate                                           |
| WHICH-109 | P1       | 프로필 최소 안전 Gate와 후속 AI 확장                                            |
| WHICH-110 | P2       | Capability 제한·Policy Event 만료·Risk Decay                                    |
| WHICH-111 | P1       | Side·신규 사용자·Reply Slice Random Audit와 Go/No-Go                            |
| WHICH-141 | P1       | 승인 이미지 Library·라이선스 원장                                               |

WHICH-97의 확정 계약은
[`ai-image-provider-privacy-retention-gate-v1.md`](../operations/ai-image-provider-privacy-retention-gate-v1.md)에
있다. 외부 Provider는 현재 `OFF`이며, API Key 설정만으로 활성화할 수 없다. WHICH-99와
WHICH-101은 Worker/Adapter에서 이 Gate를 호출하고, DPA·국외이전·Provider 데이터 제어·삭제
전파 증거가 하나라도 빠지면 요청을 만들지 않아야 한다.

권장 Critical Path:

```text
WHICH-91
  -> WHICH-92 + WHICH-93 + WHICH-97
  -> WHICH-94 + WHICH-98 + WHICH-108
  -> WHICH-95 + WHICH-96 + WHICH-99 + WHICH-100
  -> limited all-human member image pilot
  -> WHICH-101 + WHICH-104
  -> WHICH-102
  -> WHICH-103
  -> WHICH-105
  -> WHICH-111
```

WHICH-106·107·110은 Shadow Mode와 실제 운영 데이터가 필요성을 입증한 항목만 승격한다.
WHICH-109의 avatar 신고·격리·fallback은 현재 공개 공격면이므로 규칙 기반 최소 Gate를 먼저
진행하고, Profile AI 분류는 후속으로 분리한다.

WHICH-99의 실행 계약과 배포 전환 기준은
[`moderation-shadow-worker.md`](../operations/moderation-shadow-worker.md)를 기준으로 한다.
WHICH-100의 Dataset·평가·회귀 보고 계약은
[`moderation-golden-set-evaluation.md`](../operations/moderation-golden-set-evaluation.md)를 기준으로 한다.

## Go/No-Go 원칙

- Shadow 결과가 사람 판정과 비교 가능하고 Label별 오차가 측정된다.
- P0 Queue와 Provider 장애에서 안전한 기본 동작이 검증된다.
- 자동 조치는 모두 즉시 중단할 수 있고 원상 복구할 수 있다.
- 사용자에게 사유와 이의 제기 경로가 제공된다.
- 비용과 운영자 시간이 기존 수동 운영보다 실제로 줄어든다.
- 고위험 Slice에서 치명적 오탐·미탐이 허용 범위 안에 든다.

이미지 기능의 내부 검증 GO와 사용자 자동 공개 GO는 별개다. 최종 사용자 경험은 관리자 전수
승인이 아니라 자동 Gate 통과 후 즉시 공개를 기본으로 한다.

- `14일·10명·30개`는 업로드 UX, Queue, 통지, 복원과 운영 시간을 확인하는 Smoke Gate다.
- 내부 검증 GO만으로 자동 공개를 허용하지는 않지만, 사용자 기능을 활성화할 때는 모든 정상·저위험
  이미지를 자동 공개하고 예외만 운영자 Queue로 보낸다.
- 임시 자동 공개는 Action·Slice별 평가, 충분한 표본, 층화 Audit와 즉시 Category Kill Switch를
  별도 통과해야 한다.
- 최초 임시 공개 500개는 20% Random Audit와 경계값·신규 사용자·모델 불일치 Targeted Audit를
  수행한다.
- 심각한 안전·개인정보 공개 누락이 1건이라도 확인되면 해당 Category 자동화를 즉시 중단한다.

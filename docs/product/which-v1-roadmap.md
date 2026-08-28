# WHICH v1 Product Roadmap

- Status: Candidate roadmap — Public v0 beta evidence pending
- Last synchronized: 2026-08-28
- Source snapshot: Notion Tasks `WHICH-1` through `WHICH-69`

## 문서 목적

이 문서는 Public v0 다음에 검토할 일을 하나의 상위 로드맵으로 정리한다. Notion의 전체 Task를
기준으로 완료된 기능을 다시 Backlog로 올리지 않고, 각 완료 Task에 남겨 둔 후속 범위와 현재
Backlog를 저장소 문서 및 운영 경계와 교차 점검했다.

이 문서의 항목은 모두 확정 약속이 아니다. 먼저 제한 사용자 Beta인 `WHICH-52`를 완료하고,
관찰된 문제와 지표로 v1 범위와 순서를 다시 고정한다. 선택된 항목만 별도 Notion Task로 만들며,
나머지는 이 문서의 Candidate 상태로 유지한다.

세부 점수식, 모델 및 안전 원칙은
[`post-v0-discovery-recommendation-ai-roadmap.md`](./post-v0-discovery-recommendation-ai-roadmap.md),
커뮤니티 신고·제재 기준은
[`community-enforcement-policy-v1.md`](./community-enforcement-policy-v1.md),
Public v0 경계는 [`public-v0-release-scope.md`](./public-v0-release-scope.md)를 기준으로 한다.

## 전체 Task 점검 결과

| 구분                                                                            | 현재 상태 | v1 판단                                                 |
| ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| `WHICH-1`–`WHICH-51`                                                            | Done      | 구현 완료 범위와 남겨 둔 후속 범위만 검토               |
| [`WHICH-52`](https://app.notion.com/p/3c628b27a559817692e3d80a5effb46a?pvs=204) | Doing     | 모든 v1 우선순위의 선행 Gate                            |
| [`WHICH-53`](https://app.notion.com/p/3c628b27a5598122bf8df2ed0d6cf34a?pvs=204) | Backlog   | Trending v1 후보                                        |
| [`WHICH-54`](https://app.notion.com/p/3c628b27a559816fa482ccc53aad8039?pvs=204) | Backlog   | 고품질 Feed 추천 v1 후보                                |
| [`WHICH-55`](https://app.notion.com/p/3c628b27a55981c4bd38d8e7a6e0a674?pvs=204) | Backlog   | AI Editorial·Moderation v1 후보                         |
| `WHICH-56`–`WHICH-69`                                                           | Done      | 운영 보강, Creator, Review Console, UI 후속 범위를 검토 |

현재 Notion에서 미완료인 Task는 `WHICH-52`–`WHICH-55`뿐이다. 다만 Done Task 중
[`WHICH-22`](https://app.notion.com/p/3c228b27a559817ca4dbf9c839968cb9?pvs=204),
[`WHICH-57`](https://app.notion.com/p/3c628b27a55981efb62fcfe504a31fae?pvs=204),
[`WHICH-58`](https://app.notion.com/p/3c628b27a5598117b687fc31949a725b?pvs=204)에 명시된 후속 범위와
운영 문서의 알려진 한계도 v1 후보로 포함한다.

## v1을 여는 Gate — 제한 사용자 Beta

v1 기능 구현보다 먼저 `WHICH-52`를 완료한다. 최소 7일 동안 초대 사용자 10명, 구조화 피드백
5명, Qualified Session 10개 이상을 기본 관찰 기준으로 삼는다. 숫자만 채우는 것이 아니라 다음
질문에 답할 수 있어야 한다.

- 처음 방문한 사용자가 설명 없이 첫 투표를 완료하는가?
- 결과를 확인한 뒤 다음 질문으로 자연스럽게 이어지는가?
- 질문 재고 부족, 중복 노출, 이미 투표한 질문 재노출이 실제 이용을 막는가?
- 질문 작성과 댓글에서 운영자가 감당하기 어려운 안전·품질 문제가 생기는가?
- 로그인, 모바일, 프로필, 공유 중 이탈을 만드는 경로는 무엇인가?
- 재방문 이유가 부족한가, 아니면 질문 품질과 추천 정확도가 부족한가?

판단의 중심 지표는 QVPS, Feed→Vote, Vote→Result, Vote→Next, Session Depth, 재방문,
신고·숨김·운영 부하이다. SEV-1 데이터 사고나 핵심 Vote 사실 불일치가 있으면 v1 확장보다 먼저
안정화한다.

## 권장 릴리스 구조

```text
Public v0 Beta (WHICH-52)
  -> Beta finding triage and v1 scope freeze
  -> v1 Core: Creator safety + content supply + discovery
  -> v1 Recommendation: shadow evaluation + guarded rollout
  -> v1 Safety/Operations: AI assist + production hardening
  -> Parallel lane: Native Member identity and store readiness
  -> v1.x candidates selected by retention evidence
```

기본 순서는 아래와 같다. Beta에서 더 큰 문제가 확인되면 순서를 바꾸되, 근거와 변경 이유를
Notion Task에 남긴다.

| Wave     | 기본 우선순위                    | 완료 증거                                        |
| -------- | -------------------------------- | ------------------------------------------------ |
| Gate 0   | `WHICH-52` Beta 완료 및 Go/No-Go | 실제 사용자·지표·장애·운영 부하 기록             |
| Wave 1   | Creator 생명주기와 UGC 안전      | 작성자 제어, 검수, 복구 가능한 Moderation        |
| Wave 2   | 승인 콘텐츠 공급과 Trending      | 재고 안정성, 설명 가능한 Trend Surface           |
| Wave 3   | 고품질 Feed 추천                 | 기존 `interest_content_v1` 대비 반복 가능한 개선 |
| Wave 4   | AI 보조 및 운영 자동화           | Golden Set, Shadow, 사람 승인, Rollback          |
| Parallel | Native Member와 배포 준비        | PKCE, 안전한 Session, Internal/TestFlight 증거   |

## v1 Core

### 1. Creator 질문 생명주기와 UGC 안전

- Origin: `WHICH-57` 후속 범위
- 권장 우선순위: P0 — Member 질문 공개 작성이 이미 운영 중이라면 가장 먼저 검토

**문제**

현재 Member는 LOW-risk, 비정치, 링크 없는 A/B 질문을 즉시 게시할 수 있지만, 서버 저장 Draft,
게시 후 수정·삭제·종료, 사람 검수 Queue, 광범위한 UGC Moderation은 없다. 작성 Surface만 넓히고
회수·정정 경로가 부족하면 운영 위험이 추천보다 먼저 커진다.

**v1 범위**

- 서버 저장 Draft와 기기 간 복구;
- 게시 전 Preview와 작성 문구 품질 안내;
- 작성자 질문 수정, 종료, 삭제 요청과 Vote 사실 보존 규칙;
- 운영자 Review Queue, 상태 이력, 승인·거절 사유;
- 신고 임계치 기반 임시 노출 제한과 사람 검토;
- 즉시 공개 가능 범위와 사전 검수 필요 범위의 정책 분리;
- Creator별 Rate Limit, 품질 신호, 반복 위반 대응.

**완료 기준**

- 이미 Vote가 있는 Issue의 질문 의미와 Vote·Outbox 사실을 덮어쓰거나 삭제하지 않는다.
- 작성자와 운영자 동작이 감사 가능한 상태 이력으로 남는다.
- 수정·종료·삭제·복구가 Feed, Detail, Result, 공유 링크에서 일관된다.
- Feature Flag와 Kill Switch로 공개 작성 또는 검수 경로를 즉시 제한할 수 있다.

**제외**

무제한 공개 게시, 정치·선거 질문, 모델 단독 영구 제재, 작성자 수익화는 v1 Core에 포함하지 않는다.

### 2. 승인 콘텐츠 공급 운영

- Origin: `WHICH-49`, `WHICH-58`, Issue Pack 운영 문서
- 권장 우선순위: P0/P1 — Beta의 실제 소진 속도로 결정

**문제**

500개 Candidate Ledger와 Local Editorial Review Console은 준비되어 있지만, Candidate는 승인된
Pack이 아니다. 현재 `dailyPublicationTarget: 6`은 재고 계산용 운영 목표이며 “매일 AI가 6개를
생성·자동 게시한다”는 기능이 아니다. 게시 동작은 의도적으로 수동이며 fail-closed이다.

**v1 범위**

- Human Review를 거친 LOW-risk subset과 Publication Plan 확정;
- 출처 적합성, 만료일, 유사 문구, Category 균형, Risk 재검증;
- 승인된 Pack만 대상으로 하는 예약 게시;
- Days of Supply, Feed Health, 신고율, Category 집중도에 따른 자동 중지;
- Dry-run, Digest 확인, 멱등 게시, Conflict 중단 계약 유지;
- 재고·게시·소진·중지 이유를 한 화면에서 확인하는 운영 View.

**완료 기준**

- 미승인 Candidate 또는 MEDIUM-risk 질문은 예약 게시 대상에 들어갈 수 없다.
- 동일 Pack 재실행은 NOOP이고 중복 Issue·Outbox Event를 만들지 않는다.
- 자동화 장애 시 안전한 Empty/Fallback으로 전환하고 직접 SQL 수정이 필요하지 않다.
- 게시 중지와 Rollback 절차가 운영 증거로 반복 가능하다.

### 3. 안전한 Trending 질문 Surface

- Origin: `WHICH-53`
- 권장 우선순위: P1

**사용자 가치**

지금 사람들이 활발히 선택하는 질문을 빠르게 발견하되, 논쟁성이나 총 Vote 수만으로 품질 낮은
질문을 증폭하지 않는다. Desktop Right Rail에는 Trending Questions, Mobile에는 Feed 흐름을
해치지 않는 Compact Section을 제공한다.

**v1 범위**

- 게시·Lifecycle·Moderation·중복·이미 투표함을 먼저 검사하는 Eligibility Gate;
- Qualified 참여 속도와 가속도, Freshness, Vote→Next 품질, 낮은 신고율, Editorial Confidence;
- Category·Source·Creator 다양성, 집중 Traffic 탐지, 근접 중복 제거;
- Empty·Sparse·Abuse 상황의 안정적인 Editorial Fallback;
- Staff-only Preview, 점수 구성 로그, Feature Flag, 즉시 Rollback.

**완료 기준**

- 시간 창, 최소 표본, 감쇠, Concentration 임계치가 숫자로 정의된다.
- 총 Vote, A/B 박빙, 논쟁성 하나만으로 Trending에 진입하지 못한다.
- QVPS와 Vote→Next 개선을 보되 신고, 이탈, 집중도, 지연 시간을 Guardrail로 둔다.
- Desktop·Mobile·Empty·Sparse·Abuse QA가 모두 통과한다.

### 4. High-quality Feed Recommendation

- Origin: `WHICH-54`
- 권장 우선순위: P1 — Trending과 Exposure 계약 이후

**목표 구조**

```text
Eligibility
  -> Candidate retrieval
  -> Quality-aware ranking
  -> Policy and diversity re-ranking
  -> Exploration and deterministic fallback
  -> Feed slate
```

**v1 범위**

- `interest_content_v1`을 비교 가능한 현행 Baseline으로 고정;
- Exposure, Candidate Source, Score Component, Model·Policy Version, Fallback Reason 기록;
- 명시적 관심사, 신선한 Editorial, 고품질 Discovery, 제한된 Exploration Candidate 혼합;
- Logistic Regression부터 시작하고 데이터가 충분할 때만 LightGBM LTR 평가;
- Category·Source·Creator·Semantic Duplicate 집중 제한;
- Offline Replay → Shadow Mode → 제한 A/B 또는 Interleaving → 단계적 공개.

**성공 지표**

- QVPS, Feed→Vote, Vote→Next, Session Depth, Returning Qualified Voter가 Baseline보다 개선된다.
- 신고·숨김·Skip·급격한 이탈, 주제 집중, 신규 질문 노출, p95 Latency, Fallback Rate가 악화되지 않는다.
- Guest와 Member 중 한 집단의 품질을 희생해 전체 평균만 높이지 않는다.

**안전 경계**

선택 이력으로 정치 성향 같은 민감 특성을 추론하지 않는다. 충분한 데이터와 Exposure Log 없이
Two-Tower, Sequence Model, 실시간 Bandit 또는 Black-box Ranker를 도입하지 않는다.

## v1 Safety & Operations

### 5. Community Enforcement Hardening

- Origin: 복수 최상위 댓글·무한 Reply Thread 공개 이후의 안전 운영 보강
- 권장 우선순위: P0/P1 — 댓글 참여 제한을 완화한 만큼 가역 제재와 신고 공격 방어를 먼저 확보

**현재 기준**

- 댓글 수와 Reply 깊이는 제재 근거가 아니다.
- 신고 임계치 기반 Collapse·Hide는 콘텐츠 단위의 임시 조치이며 자동 삭제가 아니다.
- Raw Report, 싫어요와 의견의 비인기는 Member Strike로 누적하지 않는다.

**v1 범위**

- canonical Report Reason, Severity와 Content→Thread→Feature→Account Action Ladder;
- Report Cluster, Subject dedupe, Reporter reliability Shadow와 신고 남용 Case;
- 확인된 위반만 보존하는 append-only Policy Event와 기간·감쇠;
- 반복 Spam의 짧은 Comment Cooldown, Premoderation과 Thread Slow Mode·Lock;
- Notice, Appeal, 완전 복구와 자동 제재 Kill Switch;
- A/B Side·Guest·신규 사용자·깊은 Reply Slice별 오탐 Guardrail.

**완료 기준**

- 하나의 Report Cluster나 신고 수만으로 계정 제한이 발생하지 않는다.
- 24시간 초과 Feature 제한과 모든 Account 제한은 사람 승인을 요구한다.
- Appeal 인용 시 콘텐츠, 작성 권한, 유효 위험 점수와 Ranking 파생 상태가 함께 복구된다.
- 정상 댓글·답글 참여가 안전 개선보다 크게 감소하면 자동화 확대를 중지한다.

세부 단계와 기존 `WHICH-91`–`WHICH-111` 연결은
[`community-enforcement-policy-v1.md`](./community-enforcement-policy-v1.md)를 따른다.

### 6. AI Editorial·Moderation Assist

- Origin: `WHICH-55`
- 권장 우선순위: P2 — `WHICH-49`, `WHICH-50`, `WHICH-52`의 Label과 운영 결과가 선행

**적합한 첫 기능**

- WHICH 문체의 균형 잡힌 질문·A/B 초안을 제안하는 Editorial Copilot;
- 모호함, 선택지 겹침, 유도 문구, 시의성, 출처, Risk를 분류하는 Quality/Risk Classifier;
- 한국어 욕설·괴롭힘·Spam·맥락성 표현을 운영자에게 우선순위로 보여 주는 Comment Triage;
- 중복·유해성·인기 조작을 억제하는 A/B 대표 댓글 Re-ranker;
- 후속 후보로 Creator Submission Coaching, 선택 이유 Clustering, 후속 질문 제안.

**도입 순서**

1. Versioned Golden Set과 고정 Rubric을 만든다.
2. Prompt-only, Fine-tuned Model, Human Reviewer를 같은 표본으로 비교한다.
3. Shadow Mode에서 기록만 남긴다.
4. Reviewer Assist로 사람의 판단을 보조한다.
5. 낮은 위험의 제한 자동화만 Feature Flag로 연다.

**금지 경계**

- AI 생성 질문을 사람 승인 없이 직접 게시하지 않는다.
- 모델 판정만으로 영구 숨김·계정 제재를 하지 않는다.
- 최신 사실과 출처를 Fine-tuned Model의 기억에 맡기지 않고 Retrieval/RAG로 근거를 연결한다.
- 추천 문제를 Generative AI로 대체하지 않는다.

### 7. Production Hardening

- Origin: Public v0 검증 문서의 명시된 v1 경계
- 권장 우선순위: P1/P2 — Beta 장애와 운영 비용에 따라 분할

- Production과 분리된 Staging 또는 최소 Preview 환경;
- 실제 데이터를 오염시키지 않는 Write-path E2E 전용 Identity와 Issue Fixture;
- 배포 후 Full Gate 자동 실행과 중앙화된 Gate·Rollback 증거;
- Render Backup Restore의 반복 가능한 Drill과 증거 보관;
- 모든 Issue Version을 대상으로 하는 Aggregate Reconciliation 정기 실행;
- Analytics 일별 집계·Retention Scheduler;
- 실제 외부 Consumer가 생길 때 Outbox Worker 운영 활성화와 Dead Letter 대응.

Outbox 코드와 Publisher는 이미 구현되어 있다. v1 항목은 신규 Outbox 구현이 아니라 실제 Consumer
연동과 운영 활성화이다. 외부 Consumer가 없다면 계속 `DEFERRED`가 맞다.

## v1 Parallel Lane — Native Mobile

- Origin: `WHICH-22` Phase 2·3
- 진입 조건: Web v1 API 계약 안정, Beta에서 Returning User 가치 확인

**Phase 2 — Native identity**

- Google, X, Naver, Kakao Authorization Code + PKCE;
- Provider별 Mobile Redirect URI와 App/Universal Link;
- Server-side Code Exchange와 제한된 Mobile Member Session;
- Keychain/Keystore 저장, 회전, 폐기, 로그아웃;
- Guest 기록의 기존 Member 연결;
- Web Cookie 재사용 또는 App Bundle 내 Client Secret 저장 금지.

**Phase 3 — Distribution**

- Play Internal Testing과 TestFlight Signed Build;
- Icon, Splash, Privacy Disclosure, Store Screenshot, Review Note;
- Crash, Startup Latency, Network Error, Accepted Vote Funnel 관측;
- 사용자가 제품 가치를 경험한 뒤에만 Push 권한 요청.

Native 구현을 Web 기능이 모두 끝날 때까지 미루거나, 반대로 Native를 먼저 완성하는 방식 모두 피한다.
공통 API와 Identity 계약은 병렬로 준비하되, 추천·Creator 정책이 안정된 뒤 Store 공개 범위를 정한다.

## v1.x 후보 — Beta 근거가 있을 때만 승격

| 후보                          | 승격 조건                                       | 기본 판단    |
| ----------------------------- | ----------------------------------------------- | ------------ |
| Search                        | 사용자가 원하는 질문을 찾지 못한다는 반복 증거  | v1.x         |
| Bookmark                      | 다시 보고 싶은 Result·질문 수요가 반복됨        | v1.x         |
| Notification                  | 재방문 계기가 부족하고 수신 가치가 명확함       | v1.x, Opt-in |
| Following·가벼운 Social Graph | 특정 Creator를 다시 찾는 행동이 확인됨          | v1.x         |
| Live Surface                  | 충분한 동시 Traffic과 운영 대응력이 있음        | v1.x         |
| Thread Safety·Navigation      | 깊은 Reply에서 공격·가독성 문제가 반복됨        | v1.x         |
| Instagram OAuth               | 유입·로그인 전환 개선 근거와 운영 필요성이 있음 | Later        |
| Channel Copy Assist           | Naver 등 외부 채널별 유입 실험이 반복 운영됨    | v1.x         |

Search, Bookmark, Notification, Following, Live를 디자인에 보인다는 이유만으로 한꺼번에 만들지 않는다.
각 Surface는 API 조회 성능, 개인정보, Moderation, 빈 상태, 측정 계약을 포함한 별도 Task로 승격한다.

## v2 또는 명시적 제외

- DM, Group, Quote Post, Real-time Chat과 별도 Social Graph 확장;
- 무제한 Creator 공개 게시와 대규모 Social Graph;
- 정치·선거 여론조사 또는 대표성 주장;
- Monetization, B2B Analytics, Multi-region, Multilingual Launch;
- 데이터 기반과 Rollback 없이 도입하는 Deep Learning Ranker;
- AI의 직접 게시와 모델 단독 영구 제재.

## Beta 이후 Task 생성 규칙

1. `WHICH-52`에 실제 사용자 관찰, Funnel, 장애, 신고, 콘텐츠 소진 결과를 기록한다.
2. 발견 사항을 `Blocker`, `v1 Core`, `v1.x`, `Later`, `Won't do now`로 분류한다.
3. v1 Core로 선택된 항목만 하나의 검증 가능한 결과 단위로 Notion Task를 만든다.
4. 각 Task에는 문제, 사용자 가치, 선행 데이터, 성공 지표, Guardrail, Feature Flag, Rollback을 적는다.
5. 동시에 Doing인 대형 기능을 제한하고, Main은 병합 전용·기능별 Branch 원칙을 유지한다.
6. Beta 근거 없이 이 문서의 Candidate 전체를 일정으로 약속하지 않는다.

## 제안 Task 후보명

아래 항목은 아직 Task ID를 예약하지 않는다.

- Creator Draft·질문 Lifecycle 및 Review Queue v1
- Approved Issue Pack Scheduler 및 Feed Health Stop v1
- Safe Trending Questions Surface v1 (`WHICH-53` 유지)
- High-quality Feed Recommendation Architecture v1 (`WHICH-54` 유지)
- AI Editorial·Moderation Assist v1 (`WHICH-55` 유지)
- Public v1 Staging·Write E2E·Restore Drill
- Native Member Identity with PKCE
- Play Internal Testing·TestFlight Release Readiness

## Source inventory

- [WHICH Tasks database](https://app.notion.com/p/2dc95012c8bd4db2b8f207338a027992?pvs=204)
- [`WHICH-52` — 제한 사용자 Beta 및 Go/No-Go](https://app.notion.com/p/3c628b27a559817692e3d80a5effb46a?pvs=204)
- [`WHICH-53` — Trending 질문](https://app.notion.com/p/3c628b27a5598122bf8df2ed0d6cf34a?pvs=204)
- [`WHICH-54` — Feed Recommendation](https://app.notion.com/p/3c628b27a559816fa482ccc53aad8039?pvs=204)
- [`WHICH-55` — AI Editorial·Moderation](https://app.notion.com/p/3c628b27a55981c4bd38d8e7a6e0a674?pvs=204)
- [`WHICH-57` — Member 질문 작성](https://app.notion.com/p/3c628b27a55981efb62fcfe504a31fae?pvs=204)
- [`WHICH-58` — Editorial Review Console](https://app.notion.com/p/3c628b27a5598117b687fc31949a725b?pvs=204)
- [`WHICH-22` — Native Mobile Foundation](https://app.notion.com/p/3c228b27a559817ca4dbf9c839968cb9?pvs=204)
- [`WHICH-51` — Public v0 검증 경계](https://app.notion.com/p/3c628b27a5598111b7c5ec76eae0b3e7?pvs=204)
- [`public-v0-release-scope.md`](./public-v0-release-scope.md)
- [`post-v0-discovery-recommendation-ai-roadmap.md`](./post-v0-discovery-recommendation-ai-roadmap.md)
- [`native-mobile-foundation.md`](./native-mobile-foundation.md)
- [`limited-beta-and-go-no-go.md`](../operations/limited-beta-and-go-no-go.md)
- [`issue-pack-publication.md`](../operations/issue-pack-publication.md)
- [`public-v0-release-verification.md`](../operations/public-v0-release-verification.md)

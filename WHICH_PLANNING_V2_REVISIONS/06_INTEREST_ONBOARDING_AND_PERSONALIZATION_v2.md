# WHICH 관심사 온보딩 및 개인화 v2.0

- **문서 상태:** 상세 기획 검토본
- **버전:** 2.0
- **기준일:** 2026-08-17
- **기준 문서:**
  - `01_PRODUCT_VISION_AND_PRINCIPLES_v2.md`
  - `02_CORE_UX_AND_USER_JOURNEYS_v2.md`
  - `03_ISSUE_SUPPLY_AND_CONTENT_PIPELINE_v2.md`
  - `04_ISSUE_TAXONOMY_QUALITY_AND_CONTROVERSY_v2.md`
  - `05_IDENTITY_AND_VOTE_INTEGRITY_v2.md`
  - `06_INTEREST_ONBOARDING_AND_PERSONALIZATION.md` v1
  - `07_RECOMMENDATION_AND_ML_ARCHITECTURE.md`
  - `08_SOCIAL_AND_COMMUNITY.md`
  - `09_MODERATION_AND_GOVERNANCE.md`
  - `10_METRICS_ANALYTICS_AND_EXPERIMENTS.md`
  - `13_GLOSSARY_AND_STATUS_MODEL.md`
- **문서 목적:** 신규 사용자와 행동 데이터가 적은 사용자의 Cold Start를 해결하면서, 외부 딥링크 Guest의 첫 투표 전환을 방해하지 않고, 명시적 관심사·실제 행동·다양성·탐색을 결합해 사용자에게 맞는 질문을 제공하는 관심사 온보딩 및 개인화 체계를 정의한다.
- **문서 비범위:** 최종 추천 모델의 학습 코드, 물리 DB 스키마, 특정 분석·MLOps 벤더, 최종 개인정보 법률 문구, 디자인 시스템의 시각 사양은 후속 문서에서 확정한다.

---

## 0. 결정 상태 표기

| 표기 | 의미 |
|---|---|
| **[확정]** | 후속 UX·추천·ML·개발 설계의 기본 전제로 사용한다. |
| **[설계 기준]** | 원칙은 채택하되 세부 구현과 수치는 운영 데이터로 조정할 수 있다. |
| **[초기안]** | 출시 초기 실험 또는 Calibration을 위한 가설이다. |
| **[미정]** | 별도 의사결정이나 검증이 필요하다. |
| **[금지]** | 제품 신뢰·전환·개인정보 원칙을 해치므로 채택하지 않는다. |

### 0.1 v2 주요 보강 내용

| 영역 | v1 | v2 보강 내용 |
|---|---|---|
| 온보딩 목적 | 관심사 3개 선택 | Cold Start, 첫 세션 유희성, 외부 유입 보호, 추천 학습의 기준선으로 확장 |
| Guest | 여러 이슈 후 제안 | 첫 투표 비차단, 선택형 Micro-onboarding, Prompt Budget, 유입 채널별 Guardrail 추가 |
| 관심사 구조 | 대분류 중심 | 사용자 표시 카드, 내부 Category·Topic 매핑, Experience Mode와 분리 |
| 관심 Profile | 개념 수준 | 명시·추론·부정·최근성·신뢰도·출처를 분리한 다층 Profile 정의 |
| 행동 신호 | 강·약 구분 | 이벤트 의미, 노출 편향, Skip 해석, 반복 행동, 신호 충돌 처리 추가 |
| 정치 | 선택 방향 제한 | 정치 관심과 정치 입장 분리, Choice Feature 금지, 별도 설정·Eligibility 연결 구체화 |
| 개인화 | 추천 혼합 비율 | Cold-start Feed Contract, 유희 믹스, 다양성 Budget, Exploration, Fallback 정의 |
| 사용자 제어 | 관심사 수정·재설정 | 덜 보기, 숨기기, 재설정, 설명, 데이터 삭제, Guest→Member 병합 UX 추가 |
| ML 연결 | 후속 설계 | Online/Batch Feature, Version, Label Eligibility, Feedback Loop 방지 계약 추가 |
| 운영 | 성공 지표 | Funnel, Guardrail, Experiment, Admin, QA, Rollout, Incident 대응 추가 |

### 0.2 핵심 결정 요약

1. **[확정]** 외부 딥링크 Guest의 첫 투표 전에는 관심사 선택을 요구하지 않는다.
2. **[확정]** 관심사 온보딩은 개인화를 위한 선택형 가치 제안이며 가입 장벽으로 사용하지 않는다.
3. **[확정]** 기본 구조는 관심 주제 3개 이상 선택이다.
4. **[설계 기준]** Guest도 로그인 없이 관심사를 선택하고 현재 브라우저에서 개인화 혜택을 받을 수 있다.
5. **[확정]** 신규 첫 피드는 유희·생활·취향형 질문 비중을 높인다.
6. **[확정]** 사용자가 어떤 주제에 참여했는지는 사용하되 A/B 선택 방향으로 정치·이념 성향을 만들지 않는다.
7. **[확정]** 명시적 설정과 시스템 추론을 별도 저장한다.
8. **[확정]** 개인화는 관심사만 반복하는 방식이 아니라 다양성·탐색·전체 인기·신선도를 함께 포함한다.
9. **[설계 기준]** 실제 행동은 초기 선택보다 점차 중요해지지만 명시적 사용자 설정을 조용히 덮어쓰지 않는다.
10. **[확정]** 사용자는 관심사 수정, 덜 보기, 숨기기, 추천 재설정과 개인화 데이터 삭제를 수행할 수 있어야 한다.

# 1. 문서의 역할과 제품 긴장

## 1.1 해결하려는 문제

신규 사용자는 다음 데이터가 거의 없다.

- 어떤 카테고리를 좋아하는가
- 어떤 질문 형식에 반응하는가
- 유희형과 실용형 중 무엇을 선호하는가
- 얼마나 깊게 댓글을 보는가
- 얼마나 새로운 주제를 탐색하는가
- 어떤 주제를 피하고 싶은가

추천 시스템이 이 상태에서 단순 전체 인기만 제공하면 다음 문제가 생긴다.

- 자극적인 이슈가 신규 사용자 경험을 과점한다.
- 인기 카테고리에 재고가 몰려 피드가 단조로워진다.
- 사용자가 WHICH의 개인적 가치를 느끼기 전에 이탈한다.
- 행동 데이터가 인기 노출 편향을 그대로 학습한다.
- 정치·사회 고갈등 콘텐츠가 Cold Start의 기본값이 될 위험이 있다.

반대로 첫 방문부터 긴 관심사 설문을 요구하면 다음 문제가 생긴다.

- 외부 SNS에서 특정 질문을 보러 온 사용자의 목적을 방해한다.
- 투표 전환이 감소한다.
- 관심사를 아직 모르는 사용자가 임의로 선택한다.
- 가입·설문 서비스처럼 보인다.
- 첫 가치 도달 시간이 늘어난다.

WHICH는 이 긴장을 다음 방식으로 해결한다.

```text
외부 딥링크 첫 가치
→ 가입 없이 투표와 결과
→ 몇 차례 참여 또는 개인화 의도 발생
→ 짧은 관심사 선택
→ 행동 기반 보정
→ 사용자가 직접 수정·재설정
```

## 1.2 한 줄 목표

> **첫 투표는 방해하지 않고, 첫 세션 안에서 관심의 방향을 빠르게 파악해 다음 질문의 적합성과 다양성을 함께 높인다.**

## 1.3 제품 약속

사용자에게는 다음과 같이 설명한다.

> 관심 있는 주제를 고르면 다음 질문을 더 잘 맞춰드릴 수 있습니다. 선택하지 않아도 계속 이용할 수 있습니다.

내부적으로는 다음을 약속한다.

```text
Explicit Interest
+
Behavioral Interest
+
Diversity
+
Exploration
+
Safety / Integrity
=
Personalized Feed
```

## 1.4 비목표

- 첫 방문 전 긴 취향 설문
- 온보딩 완료 없이는 투표할 수 없는 구조
- 관심사 선택을 회원가입 강제 수단으로 사용
- A/B 선택을 정치·이념·정체성 Profile로 변환
- 사용자가 고른 3개 주제만 영구 반복
- 클릭·투표만 최대화하는 개인화
- 외부 광고용 Cross-site Profile 생성
- 숨겨진 민감 특성 추론
- 관심사를 공개 프로필의 정치 성향으로 노출
- 추천 모델이 안전·정치·무결성 정책을 우회하도록 허용

# 2. 핵심 설계 원칙

## 2.1 First Value Before Personalization

**[확정]** 특정 Issue 딥링크로 들어온 Guest에게는 첫 투표와 결과 확인이 관심사 선택보다 우선한다.

```text
잘못된 흐름
SNS → 관심사 3개 선택 → 가입 → Issue

권장 흐름
SNS → Issue → Vote → Result → 선택형 관심사 제안
```

## 2.2 Optional but Valuable

관심사 선택은 건너뛸 수 있어야 한다. 다만 단순한 `나중에`가 아니라 선택했을 때 얻는 가치를 짧게 보여준다.

- 더 맞는 질문
- 관심 없는 주제 감소
- 새로운 분야 발견
- 로그인 후 여러 기기 동기화

## 2.3 Explicit and Inferred Are Different

```text
사용자가 직접 선택한 관심사
≠
시스템이 행동으로 추론한 관심사
```

두 값은 별도 저장하고, 사용자에게 직접 설정한 값은 설정 화면에서 명확하게 보여준다.

## 2.4 Topic Interest Is Not Opinion Direction

```text
AI 규제 이슈에 참여함
→ AI·기술정책 관심 신호

A를 선택함
→ 특정 정치·이념 성향 신호로 사용하지 않음
```

## 2.5 Personalization Must Preserve Discovery

개인화는 사용자가 이미 아는 것만 반복하는 기능이 아니다.

```text
맞는 질문
+
지금 인기 있는 질문
+
새로운 주제
+
유희형 질문
+
다양한 관점의 설명
```

을 섞어야 한다.

## 2.6 User Control Overrides Silent Inference

사용자가 `이 주제 덜 보기`, `관심 없음`, 관심사 삭제를 선택하면 시스템의 추론보다 우선한다.

## 2.7 Safety and Integrity Precede Relevance

높은 관심 적합도를 가진 Issue라도 다음 조건을 통과하지 못하면 추천하지 않는다.

- 게시 Eligibility
- Safety
- Risk Budget
- Vote Integrity
- Political Exposure Policy
- 중복·피로 제한

## 2.8 Playfulness Is a Cold-start Asset

신규 사용자의 첫 피드는 무거운 시사·갈등 질문보다 즉시 답할 수 있는 유희·취향·생활 공감형 Issue를 중심으로 구성한다.

유희성은 선정성·모욕·혐오·허위 전제를 의미하지 않는다.

# 3. 사용자 상태와 개인화 성숙도

## 3.1 사용자 상태

| 사용자 상태 | 개인화 입력 | 기본 경험 |
|---|---|---|
| New Guest | 유입 Issue, Referrer, 세션 Context | 유희·인기·다양성 혼합 |
| Active Guest | 익명 관심사, 세션 행동, 최근 기록 | 브라우저 단위 개인화 |
| New Member | 온보딩 관심사, Guest 병합 후보 | 명시 관심사 중심 Cold Start |
| Active Member | 명시 관심사, 장기 행동, 팔로우 | 행동·관심·탐색 혼합 |
| Returning Member | 최근성, 계절성, 재방문 Context | 장기 Profile + 최근 세션 보정 |
| Verified Member | 일반 Profile + Restricted Eligibility | 정치 Choice와 일반 관심 Profile 분리 |

## 3.2 개인화 성숙도

```text
P0  No Profile
P1  Session Context Only
P2  Explicit Interests
P3  Early Behavior
P4  Stable Behavior Profile
P5  Multi-session Personalized
```

성숙도는 사용자에게 신뢰 등급처럼 노출하지 않는다. 내부 추천 전략 선택에만 사용한다.

## 3.3 상태 전이

```text
New Guest
→ 첫 Vote
→ Active Guest
→ 관심사 선택
→ Guest Personalized
→ 가입
→ Member Merge
→ Active Member
```

사용자가 관심사를 선택하지 않아도 `Active Guest`로 계속 이용할 수 있다.

## 3.4 개인화 성숙도별 우선 신호

| 단계 | 우선 신호 |
|---|---|
| P0 | 유입 Issue, 전체 품질, 유희 믹스, 트렌드 |
| P1 | 세션 내 Vote·Skip·Next Issue |
| P2 | 명시적 관심사 |
| P3 | 초기 Category·Topic Affinity |
| P4 | 시간 감쇠된 행동 Profile |
| P5 | 장기·최근·세션 신호의 혼합 |

# 4. Guest 외부 유입 보호 정책

## 4.1 핵심 원칙

**[확정]** 외부 딥링크 Guest의 첫 투표 전환을 관심사 온보딩보다 우선한다.

다음은 첫 정상 투표 전에 표시하지 않는다.

- 전면 관심사 선택 화면
- 가입 강제
- 개인화 동의 장문 Modal
- 알림 권한 요청
- 앱 설치 유도
- 추천 재설정 안내

## 4.2 온보딩 제안 가능 시점

다음 중 하나가 발생한 뒤 제안할 수 있다.

- 정상 투표 3~5회 도달 **[초기안]**
- `For You` 또는 다음 Issue를 계속 소비함
- 사용자가 `관심사 맞춤` 기능을 직접 선택함
- 반복 Skip으로 현재 피드 적합도가 낮음
- 가입 완료 후 첫 개인화 설정
- `이 주제 덜 보기`를 처음 사용해 선호 조정 의도가 나타남

다만 첫 투표 직후에도 결과 아래 작은 Inline 카드로 제안할 수 있다. 이 경우 결과 확인과 다음 Issue 버튼을 가리지 않는다.

## 4.3 Prompt Budget

같은 사용자에게 관심사 Prompt를 반복 노출하지 않는다.

**[초기안]**

```text
세션당 전면 Prompt 최대 1회
Inline Prompt 최대 2회
거절 후 동일 세션 재노출 금지
명시적 닫기 후 7일 Cooldown 후보
완료 후 일반 Prompt 중단
```

정확한 수치는 실험으로 결정한다.

## 4.4 외부 유입 Guardrail

관심사 온보딩 실험은 다음을 악화시키지 않아야 한다.

```text
External Landing → Vote Select
External Landing → Vote Accepted
Guest First Result View
Next Issue Rate
Session Exit Before First Vote
Page Load / Interaction Latency
```

**[설계 기준]** 첫 투표 전환이 유의하게 감소하면 Interest Completion이 증가했더라도 실패한 실험으로 본다.

## 4.5 Guest가 선택하지 않은 경우

건너뛴 사용자는 불완전한 사용자로 취급하지 않는다.

```text
관심사 없음
→ 유희·인기·최신·탐색 혼합 피드
→ 세션 행동으로 약한 Profile 형성
→ 나중에 선택 기회 제공
```

## 4.6 Guest 개인화의 범위

Guest에게도 다음이 가능하다.

- 관심 주제 선택
- 이 주제 덜 보기
- Issue 숨기기
- 추천 재설정
- 브라우저 단위 최근 행동 반영

다음은 Member 기능으로 구분할 수 있다.

- 여러 기기 동기화
- 장기 기록 보존
- Creator·Topic Follow
- 완전한 설정 복구
- 계정 기반 데이터 내보내기

## 4.7 Guest 데이터 손실 안내

Cookie 삭제, 브라우저 변경, 시크릿 모드에서는 Guest 관심사가 사라질 수 있다. 이를 과도하게 경고하지 않되 설정 화면에서 다음처럼 설명한다.

> 로그인하지 않은 관심 설정은 이 브라우저에만 저장됩니다.

# 5. 관심사 Taxonomy와 사용자 표시 카드

## 5.1 내부 분류와 사용자 카드 분리

내부 Taxonomy는 운영·추천의 안정 코드다.

```text
Primary Category
Subcategory
Controlled Topic
Experience Mode
Risk Level
```

사용자에게는 이해하기 쉬운 관심사 카드로 보여준다.

```text
내부: CULTURE_ENT / GAME / CONSOLE_GAME
표시: 게임
```

## 5.2 초기 사용자 관심사 카드

**[초기안]** 신규 온보딩에는 12~16개의 카드 범위를 사용한다.

```text
생활
음식
여행
연애·관계
직장
경제·소비
IT·테크
게임
영화·드라마
음악·콘텐츠
스포츠
교육
사회
취미
```

정치·선거는 기본 카드에서 제외하거나 별도 고지·설정으로 분리한다.

## 5.3 관심 카드 설계 원칙

- 사용자 언어를 사용한다.
- 한 카드가 지나치게 넓거나 좁지 않게 한다.
- 서로 겹치는 카드의 의미를 설명 가능하게 한다.
- 이미지가 없어도 이해 가능해야 한다.
- 카드 순서를 개인화 이전에는 편향 없이 구성한다.
- 정치·민감 카드를 유희 카드와 같은 방식으로 가볍게 제시하지 않는다.
- 내부 코드 변경과 사용자 표시명을 분리한다.

## 5.4 대분류와 카드 매핑

| 사용자 카드 | Primary Category | 대표 Subcategory·Topic |
|---|---|---|
| 생활 | LIFE | 주거, 교통, 생활매너, 반려동물 |
| 음식 | LIFE | 음식취향, 외식, 요리, 카페 |
| 여행 | LIFE | 국내여행, 해외여행, 여행스타일 |
| 연애·관계 | RELATIONSHIP | 연애, 결혼, 친구, 가족 |
| 직장 | WORK_CAREER | 직장문화, 업무방식, 이직, 취업 |
| 경제·소비 | ECONOMY_CONSUMPTION | 가격, 소비문화, 재테크, 물가 |
| IT·테크 | TECH | AI, 스마트폰, 플랫폼, 개발 |
| 게임 | CULTURE_ENT | 콘솔, PC, 모바일, e스포츠 |
| 영화·드라마 | CULTURE_ENT | 영화, 드라마, OTT |
| 음악·콘텐츠 | CULTURE_ENT | 음악, 크리에이터, 웹툰, 방송 |
| 스포츠 | SPORTS | 경기, 선수, 관람문화 |
| 교육 | EDUCATION | 학교생활, 대학, 학습, 교육문화 |
| 사회 | SOCIETY | 공공예절, 세대, 복지, 환경 |
| 취미 | LIFE / CULTURE_ENT | 운동, 독서, 수집, 창작 |

## 5.5 Topic 확장

초기에는 대분류 카드 3개 이상을 선택하고, 이후 다음 경로로 세부 Topic을 추가한다.

- 설정에서 직접 추가
- Topic Follow
- 반복 행동에서 추론
- 특정 카테고리 진입 시 선택형 제안
- Creator Follow에서 약한 보조 신호

## 5.6 Experience Mode는 관심사가 아니다

다음은 주제와 소비 방식의 차이다.

```text
관심사: IT·테크
Experience Mode: PLAYFUL_QUICK
```

사용자가 IT를 좋아하면서 가벼운 질문을 선호할 수 있고, 같은 사용자가 직장 주제에서는 실용 판단을 선호할 수 있다.

따라서 Experience Mode Preference는 별도 Feature로 관리한다.

# 6. 온보딩 화면 구조

## 6.1 기본 문구

```text
어떤 이야기에 관심이 있나요?
관심 있는 주제를 3개 이상 골라주세요.
나중에 언제든 바꿀 수 있습니다.
```

보조 문구:

> 선택한 주제와 실제 이용 기록을 바탕으로 질문을 추천합니다. 어떤 답을 골랐는지로 정치 성향을 만들지는 않습니다.

## 6.2 기본 화면 요소

- 제목
- 짧은 가치 설명
- 관심사 카드
- 선택 개수 표시
- `선택 완료`
- `나중에`
- 개인정보·개인화 설명 진입
- 접근성용 선택 상태

## 6.3 카드 상태

```text
UNSELECTED
SELECTED
DISABLED
RECOMMENDED
```

`RECOMMENDED`는 시스템이 제안한 카드일 뿐 자동 선택하지 않는다.

## 6.4 최소·최대 선택

**[확정]** 최소 3개를 기본으로 한다.

**[초기안]** 최대 8개를 권고한다.

최대값의 목적은 사용자를 제한하는 것이 아니라 모든 카드를 선택해 개인화 의미가 사라지는 상황을 줄이는 것이다. `전체 관심`을 허용할 경우 별도 옵션으로 처리한다.

## 6.5 선택 완료 전 UX

- 0개: 완료 버튼 비활성 또는 `3개 이상 선택` 안내
- 1개: `2개 더 골라주세요`
- 2개: `1개 더 골라주세요`
- 3개 이상: 완료 가능
- 최대 도달: 다른 카드를 선택하려면 기존 선택 해제 안내

Guest에게는 `나중에`를 항상 제공한다.

## 6.6 카드 정렬

초기 기본 정렬은 다음을 조합할 수 있다.

- 유희·대중성 높은 카드 우선
- 전체 카테고리 균형
- 유입 Issue와 관련된 카드 일부 강조
- 정치·Restricted 제외
- 특정 성별·연령을 가정한 정렬 금지

유입 Issue와 관련된 카드를 강조하더라도 자동 선택하지 않는다.

## 6.7 접근성

- 색상만으로 선택 상태를 표시하지 않는다.
- 키보드로 모든 카드 선택·해제 가능
- 스크린리더에 선택 수와 상태 전달
- 큰 글자에서도 카드 라벨이 잘리지 않음
- Motion 감소 설정 지원
- 최소 터치 영역 확보
- 카드가 많으면 검색보다 그룹·스크롤을 우선하고, 포커스 위치를 보존

# 7. 온보딩 상태 모델

## 7.1 상태

```text
NOT_ELIGIBLE
ELIGIBLE
PROMPTED
IN_PROGRESS
COMPLETED
SKIPPED
COOLDOWN
RESET
```

## 7.2 상태 의미

| 상태 | 의미 |
|---|---|
| `NOT_ELIGIBLE` | 첫 가치 전이거나 Prompt 조건 미충족 |
| `ELIGIBLE` | 온보딩을 제안할 수 있음 |
| `PROMPTED` | Prompt가 실제로 보임 |
| `IN_PROGRESS` | 사용자가 선택 화면에 진입 |
| `COMPLETED` | 최소 선택 조건을 충족해 저장 |
| `SKIPPED` | 사용자가 건너뜀 |
| `COOLDOWN` | 재노출 제한 기간 |
| `RESET` | 기존 Profile을 재설정함 |

## 7.3 전이

```text
NOT_ELIGIBLE
→ 첫 Vote / 가입 / 명시적 진입
→ ELIGIBLE
→ PROMPTED
→ IN_PROGRESS
→ COMPLETED
```

또는:

```text
PROMPTED
→ SKIPPED
→ COOLDOWN
→ ELIGIBLE
```

## 7.4 Guest와 Member 차이

Guest는 Prompt를 건너뛰어도 서비스 사용을 계속할 수 있다.

Member도 원칙적으로 건너뛸 수 있게 하는 편이 권장되지만, 회원가입 직후 필수 여부는 실험 대상이다. 필수로 하더라도 외부 딥링크의 투표와 결과 확인이 끝난 이후에만 적용한다.

## 7.5 상태 Version

다음을 기록한다.

```text
onboarding_schema_version
interest_taxonomy_version
prompt_variant
copy_variant
completion_timestamp
```

관심사 카드 구조가 바뀌어도 과거 선택을 해석할 수 있어야 한다.

# 8. Member 온보딩 여정

## 8.1 신규 가입 흐름

```text
가입 성공
→ 현재 문맥 복원
→ 필요한 경우 Guest 기록 병합 제안
→ 관심사 선택
→ For You 진입
```

외부 Issue에서 댓글 작성을 위해 가입한 경우 다음 흐름이 우선한다.

```text
댓글 작성 의도
→ 가입
→ 작성 문장 복원
→ 댓글 등록
→ 관심사 온보딩은 이후 제안
```

관심사 화면 때문에 원래 의도를 잃게 하지 않는다.

## 8.2 가입 경로별 우선순위

| 가입 계기 | 가입 후 우선 행동 | 관심사 제안 시점 |
|---|---|---|
| 투표 기록 저장 | 기록 병합 | 병합 후 |
| 댓글 작성 | 댓글 복원·등록 | 댓글 후 |
| 이슈 생성 | Draft 복원 | 제출 전 또는 후 |
| 팔로우 | Follow 완료 | Follow 후 |
| 일반 홈 가입 | 관심사 선택 | 즉시 가능 |

## 8.3 기존 회원 재온보딩

다음 경우 전체 온보딩을 다시 강제하지 않는다.

- 관심사 Taxonomy 일부 변경
- 신규 카드 추가
- 장기간 미접속
- 행동과 명시 관심사의 불일치

대신 다음처럼 부분 제안을 사용한다.

> 요즘 게임 이슈에 자주 참여하고 있어요. 게임을 관심 주제로 추가할까요?

사용자의 실제 A/B 선택 방향은 제안 근거로 보여주지 않는다.

# 9. Guest 온보딩 여정

## 9.1 기본 흐름

```text
외부 Issue
→ Vote
→ Result
→ Next Issue
→ 여러 차례 참여
→ Inline Personalization Prompt
→ 관심사 선택
→ 다음 요청부터 반영
```

## 9.2 Inline Prompt

결과 또는 다음 Issue 사이에 작은 카드 형태로 제공한다.

```text
관심 주제를 고르면
다음 질문을 더 잘 맞춰드릴게요.

[관심사 고르기] [지금은 괜찮아요]
```

결과와 다음 Issue 버튼을 가리지 않는다.

## 9.3 Full-screen Prompt 조건

다음 조건에서만 전면 화면을 고려한다.

- 사용자가 직접 `관심사 맞춤`을 눌렀음
- 세션 내 충분한 가치 경험이 발생함
- 동일 세션에 전면 Prompt가 아직 없음
- 현재 댓글·공유·작성 의도가 없음
- 전환 Guardrail이 정상 범위임

## 9.4 Guest Profile 저장

```text
guest_interest_profile
anonymous_subject_id
explicit_interests
negative_preferences
recent_behavior
created_at
updated_at
profile_version
```

정확한 DB 스키마는 후속 Data Architecture에서 확정한다.

## 9.5 Returning Guest

같은 브라우저에서 돌아온 Guest에게는 다음을 복원한다.

- 선택 관심사
- 덜 보기 설정
- 최근 본 Issue 제외 정보
- 추천 재설정 상태
- 완료한 온보딩 상태

투표 이력 공개 여부와 보존 범위는 별도 정책에 따른다.

# 10. 관심 Profile의 논리 구조

## 10.1 Profile 구성

```text
user_interest_profile
├─ explicit_category_weights
├─ explicit_topic_weights
├─ inferred_category_weights
├─ inferred_topic_weights
├─ experience_mode_preferences
├─ negative_preferences
├─ followed_topics
├─ followed_creators
├─ recent_session_vector
├─ long_term_vector
├─ confidence
├─ source_breakdown
└─ version / timestamps
```

## 10.2 명시 관심사

사용자가 직접 선택한 Category·Topic이다.

특성:

- 기본 가중치가 높다.
- 천천히 감소한다.
- 설정 화면에서 보여준다.
- 사용자가 삭제하면 즉시 반영한다.
- 시스템이 조용히 자동 삭제하지 않는다.

## 10.3 추론 관심사

행동에서 계산한다.

특성:

- 최근 행동에 민감하다.
- 노출 편향을 고려한다.
- 신뢰도와 표본 수를 가진다.
- 사용자에게 설명 가능한 수준으로 요약한다.
- 민감한 정치 입장 추론에 사용하지 않는다.

## 10.4 부정 선호

```text
NOT_INTERESTED
LESS_THIS_TOPIC
HIDE_CREATOR
HIDE_ISSUE
MUTE_TOPIC
```

부정 선호는 일반적인 Skip보다 강하게 반영한다.

## 10.5 단기와 장기 Profile

```text
Long-term Profile
→ 지속 취향

Recent Profile
→ 최근 관심 변화

Session Context
→ 지금 이 세션에서의 의도
```

최종 추천은 세 가지를 혼합한다.

## 10.6 Confidence

관심 가중치에는 값뿐 아니라 신뢰도를 함께 둔다.

예:

```text
AI affinity = 0.82
confidence = 0.31
```

한 번의 Vote로 강한 장기 관심이라고 단정하지 않는다.

# 11. 관심사 신호 출처

## 11.1 신호 Source

```text
ONBOARDING
MANUAL
BEHAVIOR
FOLLOW_TOPIC
FOLLOW_CREATOR
SESSION_CONTEXT
IMPORT_FROM_GUEST
SYSTEM_EXPLORATION
```

## 11.2 Source별 의미

| Source | 의미 | 기본 신뢰 |
|---|---|---:|
| `ONBOARDING` | 첫 관심사 선택 | 높음 |
| `MANUAL` | 설정에서 직접 변경 | 매우 높음 |
| `BEHAVIOR` | 실제 행동 추론 | 표본 의존 |
| `FOLLOW_TOPIC` | Topic Follow | 매우 높음 |
| `FOLLOW_CREATOR` | Creator 관계에서 파생 | 약함~중간 |
| `SESSION_CONTEXT` | 현재 세션의 단기 의도 | 짧은 수명 |
| `IMPORT_FROM_GUEST` | Guest Profile 병합 | 사용자 확인 후 높음 |
| `SYSTEM_EXPLORATION` | 시스템이 테스트 노출 | 관심 증거 아님 |

## 11.3 우선순위

충돌 시 기본 우선순위는 다음과 같다.

```text
사용자 명시적 부정
>
사용자 명시적 관심
>
Topic Follow
>
반복 행동
>
단일 세션 행동
>
Creator Follow 파생
>
단순 노출
```

## 11.4 Source Breakdown

각 관심 값이 무엇으로 형성됐는지 추적한다.

```text
GAME
- ONBOARDING 0.40
- BEHAVIOR 0.35
- FOLLOW_TOPIC 0.20
- SESSION_CONTEXT 0.05
```

사용자에게 내부 수치를 그대로 보여줄 필요는 없지만 운영·디버깅에는 필요하다.

# 12. 행동 신호 정의

## 12.1 이벤트별 기본 의미

| 행동 | 관심 신호 | 주의점 |
|---|---:|---|
| Viewable Impression | 거의 없음 | 노출 자체는 시스템 선택 |
| 2초 미만 Skip | 약한 부정 후보 | 로딩·실수 가능 |
| 반복 즉시 Skip | 부정 | 동일 Category 반복 시 강해짐 |
| Vote | 강한 긍정 | Choice 방향은 별도 제한 |
| Result View | 중간 | 투표 성공과 함께 해석 |
| Result Dwell | 중간 | 결과 복잡도 영향 |
| Comment Open | 강함 | 깊은 참여 |
| A/B 양쪽 댓글 열람 | 강함 | 관점 탐색 신호 |
| Comment Create | 매우 강함 | 주제 관심과 표현 의도 |
| Share | 매우 강함 | 공유 이유가 다양함 |
| Next Issue | 세션 만족 보조 | 현재 Issue 관심과 동일하지 않음 |
| Not Interested | 강한 부정 | 즉시 반영 |
| Less This Topic | 매우 강한 부정 | Category·Topic에 적용 |
| Issue Create | 매우 강함 | 생산 관심 |
| Topic Follow | 명시적 강함 | 장기 Profile |
| Creator Follow | 약한 Topic 파생 | 작성자 전체 주제 다양성 고려 |

## 12.2 Vote의 해석

Vote는 질문 주제에 관여할 의사가 있다는 강한 신호다. 그러나 다음을 자동 의미하지 않는다.

- 해당 주제를 좋아한다.
- 해당 주제에 긍정적이다.
- 같은 입장의 콘텐츠를 더 원한다.
- 정치적 정체성이 확정됐다.

따라서 Issue Risk와 Experience Mode를 함께 해석한다.

## 12.3 Skip의 해석

한 번의 Skip은 강한 부정으로 보지 않는다.

Skip은 다음 이유로 발생할 수 있다.

- 이미 아는 질문
- 질문이 어려움
- 순간적 시간 부족
- 화면 조작 실수
- 느린 로딩
- 관심 없음
- 유사 질문 피로

반복 패턴과 명시적 부정 피드백을 우선한다.

## 12.4 Share의 해석

공유는 관심 신호가 강하지만 찬성·지지를 의미하지 않는다. 놀람, 반박, 비판, 친구에게 질문하기 위해 공유할 수 있다.

## 12.5 댓글 양쪽 열람

A와 B 댓글을 모두 여는 행동은 특정 입장보다 `관점 탐색 성향`의 신호로 사용할 수 있다.

```text
opinion_exploration_affinity
```

단, 이를 정치적 중도 성향으로 해석하지 않는다.

# 13. 신호 가중치와 갱신

## 13.1 초기 신호 강도 예시

**[초기안]** 내부 상대 가중치 예시는 다음과 같다.

```text
ONBOARDING_SELECT        +5
MANUAL_ADD               +8
TOPIC_FOLLOW             +9
VOTE                     +4
COMMENT_OPEN             +5
BOTH_SIDE_COMMENT_OPEN   +6
COMMENT_CREATE           +8
SHARE                    +8
ISSUE_CREATE             +10
REPEATED_FAST_SKIP       -3
NOT_INTERESTED           -8
LESS_THIS_TOPIC          -10
MANUAL_REMOVE            -12
```

절대 수치가 아니라 상대 우선순위를 표현한 초기안이다.

## 13.2 시간 감쇠

```text
Effective Signal
=
Base Strength
× Time Decay
× Confidence
× Exposure Correction
```

명시적 관심사는 행동 추론보다 느리게 감소한다.

## 13.3 반복 행동

동일 Topic에서 반복 행동이 발생하면 신뢰도가 상승한다. 그러나 유사 Issue가 연속 추천됐기 때문에 발생한 자기강화일 수 있으므로 노출량으로 보정한다.

```text
Affinity
≈ Positive Actions / Eligible Impressions
```

## 13.4 Position Bias

상단에 노출된 Issue는 참여 확률이 높다. 따라서 관심 추론 시 다음을 기록한다.

- 노출 위치
- Candidate Source
- Model Version
- Exploration 여부
- Session 순서

## 13.5 Saturation

한 Topic에 많은 Vote가 쌓였다고 가중치를 무한히 올리지 않는다.

```text
초기 반복 행동
→ 빠른 Confidence 증가

충분한 표본 이후
→ 점진적 증가
```

## 13.6 Negative Override

사용자가 Topic을 직접 삭제하거나 `덜 보기`를 선택하면 추론 가중치를 즉시 제한한다.

행동이 다시 누적되더라도 즉시 자동 복원하지 않고 일정 Threshold와 재제안 과정을 거친다.

# 14. A/B 선택 방향 사용 제한

## 14.1 기본 원칙

**[확정]** 개인화의 주요 신호는 어떤 Issue에 참여했는지이며, A와 B 중 무엇을 골랐는지가 아니다.

## 14.2 일반 LOW Issue

다음처럼 제한적·비민감한 활용을 검토할 수 있다.

- 선택 완료 상태 복원
- 결과에서 내 선택 표시
- 같은 Issue의 A/B 댓글 탭 기본 선택
- 개인 통계에서 다수·소수 비율 계산

추천 관심 Profile에는 기본적으로 Choice 방향을 넣지 않는다.

## 14.3 MEDIUM·HIGH Issue

Choice는 추천 Feature로 사용하지 않거나 별도 제한된 실험 승인을 요구한다.

## 14.4 정치·선거·RESTRICTED

다음은 금지한다.

- 정당·후보 선호 Profile 생성
- 정치적 좌우·진보·보수 Label 추론
- 같은 정치 입장 Issue 추천
- 정치 선택 기반 Creator 추천
- 광고 Targeting
- 공개 Profile 표시
- 세밀한 지역별 정치 성향 분석

## 14.5 관심과 입장의 분리

```text
정치 이슈를 자주 봄
→ 정치·공공정책 콘텐츠 관심 여부 후보

특정 후보를 선택함
→ 추천 Profile에 사용하지 않음
```

정치 관심 자체도 별도 설정과 강화된 개인정보 정책 아래 둔다.

# 15. 민감 주제 개인화 정책

## 15.1 민감 주제 예

- 정치·선거
- 종교
- 건강·질병
- 범죄 피해
- 성적·가족 문제
- 특정 보호 대상 집단
- 미성년자 관련 민감 이슈

## 15.2 기본 정책

- 온보딩 기본 카드에서 제외하거나 별도 그룹으로 분리한다.
- 사용자가 명시적으로 추가하지 않은 민감 관심을 장기 Profile로 강하게 저장하지 않는다.
- 단일 행동으로 민감 관심을 생성하지 않는다.
- 외부 광고 Targeting에 사용하지 않는다.
- 설정에서 확인·삭제할 수 있어야 한다.
- 추천 설명에서 민감 추론을 노골적으로 노출하지 않는다.

## 15.3 정치 관심사

정치 콘텐츠를 제공할 경우 다음을 분리한다.

```text
정치 콘텐츠 보기 설정
정치 투표 Eligibility
정치 Choice 기록
정치 추천 Exposure
```

하나의 설정이 나머지를 자동 허용하지 않는다.

## 15.4 미성년 사용자

연령 정보를 수집·확인하는 방식이 미정이므로, MVP에서는 미성년자를 대상으로 한 민감 개인화 기능을 별도 최적화하지 않는다. 실제 대상 범위와 법률 검토 후 확정한다.

# 16. Guest Profile 수명주기

## 16.1 생성

첫 Viewable Impression 시점에 바로 장기 관심 Profile을 만들 필요는 없다.

다음 중 하나가 발생하면 생성한다.

- 첫 정상 Vote
- 관심사 선택
- 명시적 부정 피드백
- 반복 세션

## 16.2 저장 범위

- 명시 관심사
- 부정 선호
- 최근 행동 요약
- 이미 본 Issue 제한 정보
- 온보딩 상태
- Profile Version

Raw 이벤트 보존은 분석·개인정보 정책에 따른다.

## 16.3 만료

장기간 미사용 Guest Profile은 만료시킨다.

**[미정]** 정확한 기간은 개인정보·제품 복귀율을 함께 보고 결정한다.

## 16.4 Cookie 삭제와 브라우저 변경

Guest Profile은 복원되지 않을 수 있다. 이를 막기 위해 침습적 Fingerprint를 도입하지 않는다.

## 16.5 로그아웃

Member가 로그아웃하면 새 Guest Context를 발급할 수 있다. 기존 Member 관심사가 Guest에게 자동 노출되지 않게 한다.

## 16.6 공유 기기

공유 기기에서는 Guest 관심 Profile이 여러 사람의 행동을 섞을 수 있다. 다음을 제공한다.

- 추천 재설정
- 이 브라우저 관심 설정 삭제
- 로그인 후 개인 계정 전환

# 17. Guest → Member 관심사 병합

## 17.1 병합 원칙

- 자동 덮어쓰기 금지
- 사용자의 기존 Member 설정 우선
- Guest 신규 관심사는 후보로 제안
- 명시적 부정 설정은 충돌을 보여줌
- 정치·민감 관심은 자동 병합하지 않음

## 17.2 병합 시나리오

### Member 관심 없음, Guest 관심 있음

```text
Guest 관심사 제안
→ 사용자 확인
→ Member Profile 저장
```

### Member와 Guest가 동일

```text
중복 제거
→ 최근성만 갱신 후보
```

### Member와 Guest가 일부 다름

```text
기존 Member 유지
+
Guest 신규 카드 선택 제안
```

### Member가 덜 보기, Guest가 관심 있음

```text
부정 설정 우선
→ 자동 추가 금지
→ 사용자가 명시적으로 변경할 때만 해제
```

### 민감 관심 충돌

```text
자동 병합 금지
→ 별도 설정에서 확인
```

## 17.3 병합 UX

```text
이 브라우저에서 선택한 관심사를
계정에 추가할까요?

[게임] [여행] [직장]

[선택 항목 추가]
[건너뛰기]
```

## 17.4 행동 Profile 병합

Raw Guest 행동을 전부 계정에 붙이는 대신, 사용자 동의와 데이터 최소화 정책에 따라 요약 Feature만 병합하는 방식을 우선 검토한다.

# 18. Cold-start Feed Contract

## 18.1 프로필 없는 신규 Guest

첫 10개 Issue의 초기안:

| 슬롯 | 목적 |
|---:|---|
| 1 | 가장 이해하기 쉬운 PLAYFUL_QUICK |
| 2 | 다른 Category의 취향형 |
| 3 | RELATABLE_DILEMMA |
| 4 | 음식·문화·게임 등 즉답형 |
| 5 | 전체 인기 LOW~MEDIUM |
| 6 | 새로운 Category 발견 |
| 7 | 유희형 또는 Culture Pulse |
| 8 | Exploration |
| 9 | 저위험 접전 가능 Issue |
| 10 | 세션 행동을 반영한 첫 개인화 |

가드레일:

- 첫 5개 중 동일 Primary Category 최대 2개
- 첫 10개에서 최소 4개 Category
- HIGH·RESTRICTED 제외
- 동일 의미 Cluster 연속 금지
- 동일 Creator 연속 금지
- 최소 품질·Playfulness Gate 적용

## 18.2 관심사 선택 직후

**[초기안]**

```text
60% 선택 관심사
15% 행동 기반 인접 Topic
15% 전체 인기·신규
10% Exploration
```

초기 행동이 거의 없으면 행동 기반 15%는 선택 관심사와 유희형 후보에 재배분한다.

## 18.3 Active Member

```text
Explicit Interests
+
Behavior Profile
+
Following
+
Trending
+
Exploration
+
Diversity Re-ranking
```

## 18.4 Fallback

Feature Service나 추천 모델에 문제가 생겨도 피드는 동작해야 한다.

```text
품질 통과 유희형
+
전체 인기
+
최신
+
카테고리 균형
```

## 18.5 개인화 실패가 투표 실패가 되지 않음

관심 Profile을 읽지 못해도 일반 Issue 투표 API와 결과 확인은 정상 동작해야 한다.

# 19. 유희성과 개인화

## 19.1 초기 세션의 역할

유희형 Issue는 다음 목적을 가진다.

- 첫 선택의 부담 감소
- 서비스 구조 학습
- 결과 비교의 재미 제공
- 다양한 관심 신호 수집
- 공유 가능한 가벼운 소재 제공

## 19.2 관심사 선택 후에도 유희성 유지

관심사 선택을 했다고 곧바로 무거운 전문 질문만 보여주지 않는다.

```text
IT 관심 사용자
→ AI 정책만 연속 노출 X
→ 스마트폰 취향, 게임, 앱 사용, 업무 AI 등 다양한 Experience Mix
```

## 19.3 유희 피로 방지

다음 현상을 피한다.

- 모든 질문이 밈·밸런스 게임처럼 보임
- 같은 포맷 반복
- 사용자의 실제 관심보다 가벼운 질문만 노출
- 진지한 공론형 Issue가 완전히 사라짐

## 19.4 Experience Mode Preference

사용자별로 다음 성향을 약하게 학습할 수 있다.

```text
PLAYFUL_QUICK
RELATABLE_DILEMMA
HYPOTHETICAL_CHOICE
CULTURE_PULSE
PRACTICAL_JUDGMENT
PUBLIC_DELIBERATION
```

`RESTRICTED_POLITICAL`은 일반 Experience Preference와 분리한다.

# 20. 다양성·탐색·필터버블 방지

## 20.1 Diversity Budget

피드 Composer는 최소한 다음을 관리한다.

- Category Diversity
- Topic Diversity
- Experience Mode Diversity
- Creator Diversity
- Source Diversity
- Risk Budget
- Semantic Deduplication

## 20.2 연속 노출 제한 초기안

```text
최근 5개 중 동일 Category 최대 3개
동일 Topic 연속 최대 2개
동일 Creator 연속 금지
고유사도 Issue 연속 금지
HIGH 연속 노출 제한
RESTRICTED 일반 Feed 제외
```

정확한 수치는 실험 대상이다.

## 20.3 Exploration

전체 Feed의 일부는 아직 확신이 낮은 Category·Topic에 할당한다.

**[초기안]** 10~20% 범위.

Exploration 후보도 다음을 통과해야 한다.

- Quality
- Safety
- Integrity
- Risk Policy
- Seen Filter
- Duplicate Filter

## 20.4 Exploration Label

내부 로그에 다음을 구분한다.

```text
MODEL_RECOMMENDED
INTEREST_RETRIEVAL
TRENDING
FOLLOWING
EXPLORATION
EDITORIAL
FALLBACK
```

## 20.5 Filter Bubble 방지

Choice 방향을 이용해 같은 입장만 보여주는 방식을 금지한다.

댓글에서는 A와 B 의견을 탐색할 수 있게 하고, Feed에서는 다양한 주제와 질문 유형을 제공한다.

## 20.6 개인화 강도 제어

사용자가 설정에서 다음을 고를 수 있는 기능을 장기 후보로 둔다.

```text
개인화 강하게
균형 있게
새로운 주제 많이
```

MVP에서는 직접 슬라이더보다 `새로운 주제 더 보기` 같은 단순 제어를 우선한다.

# 21. 명시적 부정 피드백

## 21.1 메뉴

```text
관심 없음
이 주제 덜 보기
이 작성자 덜 보기
이 Issue 숨기기
신고
```

각 기능의 의미를 분리한다.

## 21.2 관심 없음

해당 Issue와 가까운 Topic에 강한 부정 신호를 준다. 전체 Category를 즉시 제거하지는 않는다.

## 21.3 이 주제 덜 보기

Category 또는 Topic 가중치를 명시적으로 낮춘다.

## 21.4 작성자 덜 보기

Creator 후보를 제한한다. Creator가 다루는 모든 Topic을 싫어한다고 추론하지 않는다.

## 21.5 Issue 숨기기

해당 Issue만 제외한다. 관심 Profile에는 약한 신호만 준다.

## 21.6 신고와 추천 분리

신고는 정책 위반 주장이고 `관심 없음`은 개인 선호다. 신고했다고 해당 Topic 전체를 싫어한다고 추론하지 않는다.

## 21.7 Undo

부정 피드백 직후 짧은 시간 동안 실행 취소를 제공한다.

# 22. 사용자 제어와 설정

## 22.1 관심 주제 관리

- Category 추가·삭제
- 세부 Topic Follow·해제
- 덜 보기 목록 확인
- 숨긴 Creator 확인
- 추천 재설정
- 개인화 데이터 삭제

## 22.2 추천 재설정

재설정 옵션을 분리한다.

```text
최근 추천만 재설정
추론 관심사 초기화
모든 관심 설정 초기화
Guest 브라우저 설정 삭제
```

명시 관심사까지 삭제할지 사용자가 선택한다.

## 22.3 개인화 일시 중지

장기 후보:

> 일정 기간 행동을 추천에 반영하지 않기

공용 기기·일시적 탐색에 유용할 수 있다.

## 22.4 설명

다음 수준의 설명을 제공할 수 있다.

```text
IT·테크에 관심을 표시해서
최근 게임 이슈에 참여해서
팔로우한 주제라서
현재 인기 있는 질문이라서
새로운 주제를 보여드리기 위해
```

다음은 피한다.

```text
당신은 특정 정치 성향이므로
당신과 같은 사람이 B를 선택했으므로
```

## 22.5 Profile 공개 범위

개인 관심 설정은 기본 비공개다. 공개 Creator Profile의 관심 분야는 사용자가 별도로 공개한 항목만 표시한다.

# 23. 개인정보·투명성 원칙

## 23.1 목적 제한

관심 Profile은 다음 목적에 사용한다.

- WHICH 내부 추천
- 피드 품질 분석
- 온보딩 개선
- 안전·다양성 Guardrail 측정

외부 광고 Targeting이나 제3자 Profile 판매에 사용하지 않는다.

## 23.2 데이터 최소화

- 필요한 Category·Topic 수준을 우선한다.
- 민감 특성 Label을 만들지 않는다.
- Raw 이벤트보다 요약 Feature 사용을 검토한다.
- Guest 식별과 Interest Profile을 Cross-site 추적에 사용하지 않는다.

## 23.3 사용자 안내

설정에서 다음을 설명한다.

- 어떤 데이터가 개인화에 쓰이는지
- 직접 선택과 행동 추론의 차이
- 관심사 수정 방법
- 추천 재설정 방법
- Guest 설정의 브라우저 종속성

## 23.4 데이터 삭제

회원 탈퇴·개인화 데이터 삭제 시 다음을 구분한다.

- 명시 관심사
- 추론 Profile
- 부정 선호
- Follow 관계
- Raw 이벤트
- 법적·보안 목적 Audit

정확한 보존 정책은 후속 개인정보 설계에서 확정한다.

# 24. 추천·ML Feature 계약

## 24.1 User Feature 후보

```text
explicit_category_weights
explicit_topic_weights
inferred_category_affinity
inferred_topic_affinity
experience_mode_affinity
negative_topic_weights
followed_topics
followed_creators
recent_behavior_vector
long_term_behavior_vector
profile_confidence
profile_age
onboarding_completion
```

## 24.2 User × Issue Feature

```text
category_match
topic_match
embedding_similarity
experience_mode_match
negative_preference_conflict
same_category_recent_count
similar_issue_recent_count
creator_follow_match
already_seen
previous_skip
exploration_eligibility
```

## 24.3 금지 Feature

- 정치 Choice 방향
- 추론된 정당·후보 지지
- 인종·종교·질병 Label
- 외부 광고 세그먼트
- 비공개 Vote History를 공개 Profile용 Feature로 변환

## 24.4 Feature Version

모든 추천 요청에 다음을 기록한다.

```text
user_feature_version
interest_taxonomy_version
profile_version
model_version
ranking_policy_version
```

## 24.5 Online·Batch 분리

```text
Online
→ 최근 세션 행동, 현재 Context, 즉시 부정 피드백

Batch
→ 장기 Category·Topic Affinity, 시간 감쇠, Confidence
```

## 24.6 Accepted-only 원칙

Vote Integrity 문서와 연결해 관심 학습에는 정상 `ACCEPTED` Vote를 사용한다.

```text
REVIEW
→ 학습 보류

INVALIDATED
→ Profile 재계산 또는 영향 제거
```

## 24.7 정치 데이터 격리

정치·Restricted 이벤트는 일반 Interest Feature Pipeline과 논리적으로 분리한다.

# 25. 이벤트 계측

## 25.1 온보딩 이벤트

```text
INTEREST_PROMPT_ELIGIBLE
INTEREST_PROMPT_VIEW
INTEREST_PROMPT_DISMISS
INTEREST_ONBOARDING_START
INTEREST_CARD_SELECT
INTEREST_CARD_DESELECT
INTEREST_ONBOARDING_COMPLETE
INTEREST_ONBOARDING_SKIP
INTEREST_EDIT
INTEREST_RESET
```

## 25.2 부정 피드백 이벤트

```text
NOT_INTERESTED
LESS_TOPIC
HIDE_ISSUE
HIDE_CREATOR
NEGATIVE_FEEDBACK_UNDO
```

## 25.3 공통 필드

```text
user_id / anonymous_id
session_id
onboarding_schema_version
interest_taxonomy_version
prompt_variant
entry_surface
referrer_group
selected_interest_ids
selected_count
timestamp
```

## 25.4 Prompt의 실제 노출

화면에 렌더링됐다고 `VIEW`로 기록하지 않고 실제 Viewable 상태를 기준으로 한다.

## 25.5 Funnel

```text
ELIGIBLE
→ PROMPT_VIEW
→ START
→ 1ST_SELECT
→ 3RD_SELECT
→ COMPLETE
→ FIRST_PERSONALIZED_IMPRESSION
→ FIRST_PERSONALIZED_VOTE
```

## 25.6 외부 유입 Segmentation

최소한 다음을 분리한다.

- X
- Instagram
- YouTube
- 검색
- 링크 복사
- 직접
- 내부 Feed

유입원은 개인 관심사 자체로 저장하지 않는다.

# 26. 성공 지표

## 26.1 온보딩 KPI

- Prompt Eligibility Rate
- Prompt View Rate
- Start Rate
- Completion Rate
- 평균 선택 수
- 최소 3개 도달 시간
- Skip Rate
- Cooldown 후 재진입률

## 26.2 개인화 품질 KPI

- 선택 후 첫 10개 Vote Rate
- Cold-start Votes per Session
- Next Issue Rate
- Skip Rate
- Not Interested Rate
- 관심사 수정률
- 추천 재설정률
- Return Rate
- Topic Coverage
- Category Diversity
- Exploration Success Rate

## 26.3 Guest Acquisition Guardrail

- External Landing → Vote Select
- External Landing → Vote Accepted
- First Result View
- First Vote Latency
- Exit Before Vote
- Prompt-induced Exit
- Prompt Exposure Before First Vote

`Prompt Exposure Before First Vote`는 일반 외부 딥링크에서 0에 가까워야 한다.

## 26.4 안전·신뢰 Guardrail

- HIGH·RESTRICTED 신규 Guest 노출률
- 정치 Choice Feature Leakage
- Sensitive Interest Inference Rate
- 개인화 후 신고율
- 유사 Issue 반복률
- 특정 Category 과점률
- 부정 피드백 미반영률

## 26.5 장기 KPI

- 1일·7일 재방문
- 관심사 유지·수정 패턴
- 명시 관심과 행동 Profile의 합치도
- 관심사 선택 사용자와 비선택 사용자의 장기 가치
- Profile Reset 후 만족 회복

# 27. 실험 체계

## 27.1 실험 후보

### Prompt 시점

```text
A: 3 Accepted Votes 후
B: 5 Accepted Votes 후
C: 사용자가 For You 진입 시
D: 명시적 기능 의도 발생 시만
```

### Prompt 형태

```text
A: 결과 아래 Inline
B: 다음 Issue 사이 카드
C: 홈 상단 Banner
D: Full-screen 선택 화면
```

### 최소 선택 수

```text
A: 3개
B: 5개
```

### 카드 수

```text
A: 12개
B: 16개
```

### 추천 혼합

```text
A: 관심 60 / 인기 25 / 탐색 15
B: 관심 50 / 인기 25 / 탐색 25
```

## 27.2 실험 성공 조건

Interest Completion만 보면 안 된다.

```text
Completion
+
First Vote Guardrail
+
Votes per Session
+
Next Issue Rate
+
Diversity
+
Safety
+
Return
```

## 27.3 금지 실험

- 첫 투표 전에 강제 관심사 화면
- 관심사 선택 없이는 결과 비공개
- 이미 거절한 Prompt 즉시 반복
- 정치 카드를 일반 유희 카드처럼 기본 선택
- A/B 선택을 관심 카드 추천에 직접 사용
- 숨긴 Topic을 실험군에 재노출
- Dark Pattern으로 `나중에`를 숨김

## 27.4 실험 단위

가능하면 사용자 또는 anonymous subject 단위로 고정해 세션마다 다른 Prompt를 반복하지 않는다.

# 28. 운영자·Admin 기능

## 28.1 Interest Taxonomy 관리

- 카드 추가·비활성
- 표시명 수정
- 내부 Category·Topic 매핑
- 정치·민감 플래그
- 정렬·그룹
- 버전 관리
- 번역·지역화

## 28.2 Prompt 관리

- Surface별 문구
- 노출 조건
- Cooldown
- 실험 Variant
- 외부 유입 예외
- 접근성 검수

## 28.3 Profile 분석

운영자는 개인 사용자의 민감 Profile을 임의로 열람하는 기능을 갖지 않는다. 집계·익명화된 수준으로 다음을 본다.

- 관심 카드 선택 분포
- Category Coverage
- Prompt Funnel
- Guest·Member 차이
- 재설정률
- 부정 피드백률
- 정치·민감 누출

## 28.4 긴급 제어

- 특정 관심 카드 비활성
- 특정 Topic 추천 중단
- Prompt 전체 중단
- Guest Prompt 중단
- Profile Update Job 중단
- Fallback Feed 전환

## 28.5 Audit

Taxonomy·Prompt·정치 설정 변경에는 다음을 기록한다.

```text
actor
change_type
before
after
reason
version
created_at
```

# 29. 실패·예외 처리

## 29.1 관심사 저장 실패

사용자의 선택 상태를 화면에 보존하고 재시도할 수 있게 한다. 실패했다고 모든 선택을 초기화하지 않는다.

## 29.2 Feature Service 장애

Fallback Feed를 제공한다. 투표·결과는 정상 동작해야 한다.

## 29.3 Taxonomy Version 불일치

과거 관심 코드를 현재 코드로 Mapping한다. 자동 Mapping이 불명확하면 사용자에게 수정 제안을 한다.

## 29.4 선택한 관심사의 재고 부족

다음을 순서대로 확장한다.

```text
동일 Topic
→ 동일 Category
→ 인접 Category
→ 전체 인기·유희형
```

저품질 Issue를 억지로 노출하지 않는다.

## 29.5 모든 카드 선택

개인화 의도가 넓은 사용자로 보고 Category 제한보다 다양성·인기·탐색을 강화한다.

## 29.6 아무 카드도 선택하지 않음

Guest는 계속 이용할 수 있다. Member도 정책에 따라 건너뛸 수 있다.

## 29.7 반복 재설정

오류나 공용 기기 가능성을 고려해 제한적으로 허용하되 Abuse 방지를 위해 Rate Limit할 수 있다.

## 29.8 부정 피드백 과다

추천 후보가 부족해지면 사용자에게 숨긴 주제를 조정할 수 있는 설정 진입을 제공한다. 조용히 무시하지 않는다.

# 30. QA 및 수용 기준

## 30.1 신규 외부 Guest

```text
Given 사용자가 외부 SNS Issue 링크를 열었고
When 첫 투표를 시도하면
Then 관심사 선택 없이 투표와 결과 확인이 가능해야 한다.
```

## 30.2 Guest 관심사 선택

```text
Given Guest가 3개 관심사를 선택했고
When 다음 Feed를 요청하면
Then 선택 관심사가 후보 생성에 반영되고
And Guest Browser Profile에 저장되어야 한다.
```

## 30.3 Prompt 거절

```text
Given 사용자가 관심사 Prompt를 닫았고
When 같은 세션에서 다음 Issue를 소비하면
Then 동일 Full-screen Prompt가 다시 나타나지 않아야 한다.
```

## 30.4 Guest→Member 병합

```text
Given Guest와 Member 관심사가 일부 다르고
When 로그인하면
Then 기존 Member 설정을 덮어쓰지 않고
And Guest 신규 관심사를 선택적으로 추가할 수 있어야 한다.
```

## 30.5 명시 부정 우선

```text
Given 사용자가 게임을 덜 보기로 설정했고
When 과거 게임 Vote가 많더라도
Then 게임 추천 빈도가 즉시 낮아져야 한다.
```

## 30.6 정치 Choice 금지

```text
Given 사용자가 정치 Issue에서 A를 선택했고
When 일반 추천 Feature를 생성하면
Then A 선택 방향이 정치 성향 Feature로 포함되지 않아야 한다.
```

## 30.7 Fallback

```text
Given Feature Service가 실패했고
When Feed를 요청하면
Then 품질 통과 인기·유희·최신 혼합 Feed가 반환되어야 하고
And 투표 기능은 정상 동작해야 한다.
```

## 30.8 Reset

```text
Given 사용자가 추론 관심사를 재설정했고
When 다음 추천을 요청하면
Then 과거 추론 가중치는 제거되고
And 명시 관심사 유지 여부는 사용자의 선택대로 적용되어야 한다.
```

# 31. 구현 단계

## Phase 0 — 콘텐츠 기반 Cold Start

- 관심 카드 정의
- Guest·Member 온보딩
- 명시 관심사 저장
- 유희·인기·다양성 Fallback
- 기본 Prompt Budget
- 이벤트 계측

## Phase 1 — 초기 행동 Profile

- Vote·Skip·Comment·Share 신호
- Category·Topic Affinity
- 시간 감쇠
- 부정 피드백
- Guest→Member 병합

## Phase 2 — ML Ranking 연결

- Embedding Similarity
- User × Issue Feature
- Profile Confidence
- Online Session Vector
- A/B Test

## Phase 3 — 고급 개인화

- Sequence Preference
- Experience Mode Preference
- Contextual Exploration
- Topic Follow
- Creator Follow
- 개인화 강도 제어

## Phase 4 — 실시간 최적화

- Contextual Bandit 후보
- Multi-objective Ranking
- 실시간 Feature Update
- 장기 만족·재방문 최적화

각 단계에서도 정치 Choice와 민감 추론 제한은 유지한다.

# 32. MVP 범위

## 32.1 필수

```text
Guest 첫 투표 비차단
관심사 3개 선택
Guest·Member Profile
12~16개 관심 카드
명시 관심사 저장
기본 행동 신호
이 주제 덜 보기
추천 재설정
유희·인기·탐색 혼합 Feed
Guest→Member 관심사 병합
Prompt Funnel 계측
```

## 32.2 MVP 제외 후보

- 민감 관심 고급 설정
- 개인화 강도 Slider
- 실시간 Bandit
- 공개 관심 Profile
- 정치 관심 자동 추론
- 광고 Targeting
- Cross-device Guest 복원
- 완전한 Two-Tower Personalization

## 32.3 출시 전 필수 확인

- 외부 딥링크 첫 투표에 Prompt가 나타나지 않는가
- 정치 카드가 일반 온보딩에 누출되지 않는가
- 관심 선택 후 Feed가 지나치게 한 Category로 몰리지 않는가
- `덜 보기`가 실제로 반영되는가
- Guest Profile 삭제·Reset이 동작하는가
- Feature 장애 시 Fallback이 동작하는가

# 33. 미결정 사항

## 33.1 온보딩 UX

- Guest Prompt의 정확한 시점
- Inline과 Full-screen의 비중
- 회원가입 직후 필수 여부
- 최소 3개, 최대 8개 최종 확정
- 카드 12개 또는 16개
- 카드 이미지 사용 여부

## 33.2 Profile

- Guest Profile 보존 기간
- 명시 관심사 시간 감쇠 여부
- Topic 자동 제안 Threshold
- Reset 범위
- 행동 Summary 병합 범위

## 33.3 추천

- 초기 관심·인기·탐색 비율
- Exploration 비율
- Experience Mode Preference 사용 시점
- Category Diversity 정확한 제한
- 부정 피드백 해제 조건

## 33.4 개인정보

- 개인화 동의 문구와 법적 근거
- 민감 관심 저장 범위
- 미성년자 처리
- Raw 이벤트 보존 기간
- 회원 탈퇴 후 Audit 보존 범위

## 33.5 정치

- 정치 콘텐츠 자체의 MVP 제공 여부
- 정치 관심 설정 UI
- 정치 Feed의 별도 진입 구조
- 정치 이벤트의 Feature Store 분리 방식

# 부록 A. 관심사 카드 상세 매핑

| 카드 | 내부 Category | 대표 Topic | 기본 Risk | 유희 적합성 | 운영 메모 |

|---|---|---|---|---|---|

| 생활 | LIFE | HOUSING, TRANSPORT, DAILY_MANNER, PET | LOW | 높음 | 생활 전반의 가벼운 선택 |

| 음식 | LIFE | FOOD, DINING, COOKING, CAFE | LOW | 매우 높음 | 첫 세션 핵심 유희 카드 |

| 여행 | LIFE | TRAVEL, TRIP_STYLE, DOMESTIC, OVERSEAS | LOW | 높음 | 가상 선택·취향형 |

| 연애·관계 | RELATIONSHIP | DATING, MARRIAGE, FRIEND, FAMILY | LOW~MEDIUM | 높음 | 개인 공격·젠더 갈등 주의 |

| 직장 | WORK_CAREER | WORKPLACE, REMOTE, JOB, CAREER | MEDIUM | 중간 | 공감형·실용 판단 |

| 경제·소비 | ECONOMY_CONSUMPTION | PRICE, SHOPPING, FINANCE, INFLATION | MEDIUM | 중간 | 투자 조언·정치 연계 주의 |

| IT·테크 | TECH | AI, SMARTPHONE, PLATFORM, DEVELOPMENT | LOW~MEDIUM | 높음 | 취향·업무·정책을 분리 |

| 게임 | CULTURE_ENT | GAME, ESPORTS, CONSOLE, MOBILE | LOW | 매우 높음 | 첫 세션 핵심 카드 |

| 영화·드라마 | CULTURE_ENT | MOVIE, DRAMA, OTT | LOW | 매우 높음 | 저작권·스포일러 주의 |

| 음악·콘텐츠 | CULTURE_ENT | MUSIC, CREATOR, WEBTOON, BROADCAST | LOW~MEDIUM | 높음 | 실존 인물 공격 주의 |

| 스포츠 | SPORTS | MATCH, PLAYER, FAN_CULTURE | LOW~MEDIUM | 높음 | 실시간성·선수 비방 주의 |

| 교육 | EDUCATION | SCHOOL, COLLEGE, STUDY, EDUCATION_CULTURE | MEDIUM | 중간 | 미성년자·입시 주의 |

| 사회 | SOCIETY | PUBLIC_MANNER, GENERATION, WELFARE, ENVIRONMENT | MEDIUM~HIGH | 낮음~중간 | 정치 경계 Fail-Closed |

| 취미 | LIFE / CULTURE_ENT | HOBBY, READING, FITNESS, COLLECTION | LOW | 높음 | 다양성 보완 카드 |

# 부록 B. 초기 신호 가중치 검토표

| Signal | 초기 상대값 | 유형 | 감쇠 | 해석 |

|---|---:|---|---|---|

| ONBOARDING_SELECT | +5 | 명시 | 느린 감쇠 | 초기 Category 관심 |

| MANUAL_ADD | +8 | 명시 | 매우 느린 감쇠 | 설정 직접 추가 |

| MANUAL_REMOVE | -12 | 명시 부정 | 지속 | 자동 복원 금지 |

| TOPIC_FOLLOW | +9 | 명시 | Follow 해제 전 유지 | 장기 Topic 관심 |

| VOTE | +4 | 행동 | 중간 | Choice 방향 미사용 |

| RESULT_DWELL | +2 | 행동 | 빠름 | 질문 난이도 보정 |

| COMMENT_OPEN | +5 | 행동 | 중간 | 깊은 관심 |

| BOTH_SIDE_OPEN | +6 | 행동 | 중간 | 관점 탐색 |

| COMMENT_CREATE | +8 | 행동 | 느림 | 강한 표현 의도 |

| SHARE | +8 | 행동 | 중간 | 지지로 해석 금지 |

| ISSUE_CREATE | +10 | 생산 | 느림 | 강한 주제 관심 |

| FAST_SKIP | -1 | 약한 부정 | 매우 빠름 | 단일 사건 과대해석 금지 |

| REPEATED_SKIP | -3 | 행동 부정 | 빠름 | 노출량 보정 |

| NOT_INTERESTED | -8 | 명시 부정 | 느림 | 유사 Topic 축소 |

| LESS_TOPIC | -10 | 명시 부정 | 지속 | Category·Topic 즉시 축소 |

| HIDE_ISSUE | -1 | 객체 숨김 | Issue 한정 | Topic 일반화 최소 |

| HIDE_CREATOR | Creator 제외 | 명시 부정 | 지속 | Topic 전체에 적용 금지 |

# 부록 C. 신규 Guest 첫 10개 예시 Pack

다음은 실제 질문 문구가 아니라 구성 예시다.

| 슬롯 | Category | Experience | 목적 |

|---:|---|---|---|

| 1 | 음식 | PLAYFUL_QUICK | 즉답·결과 호기심 |

| 2 | 게임 또는 문화 | PLAYFUL_QUICK | 다른 Category |

| 3 | 생활 | RELATABLE_DILEMMA | 공감 |

| 4 | 여행 | HYPOTHETICAL_CHOICE | 상상형 |

| 5 | 전체 인기 | LOW~MEDIUM | 현재성 |

| 6 | IT·테크 | CULTURE_PULSE | 발견 |

| 7 | 영화·드라마 | PLAYFUL_QUICK | 유희 |

| 8 | 탐색 Category | EXPLORATION | 새 관심 발견 |

| 9 | 저위험 접전 후보 | RELATABLE_DILEMMA | 논쟁 경험 |

| 10 | 세션 반응 기반 | PERSONALIZED | 첫 개인화 |

# 부록 D. Guest→Member 병합 매트릭스

| Member 상태 | Guest 상태 | 처리 | 비고 |

|---|---|---|---|

| Member 없음 | Guest 관심 있음 | 확인 후 추가 | 기본 권장 |

| 동일 관심 | 동일 관심 | 중복 제거 | 최근성만 갱신 후보 |

| Member 관심 있음 | Guest 신규 관심 | 선택적 추가 제안 | 자동 덮어쓰기 금지 |

| Member 덜 보기 | Guest 관심 있음 | Member 부정 우선 | 명시 해제 필요 |

| Member 관심 있음 | Guest 덜 보기 | 충돌 화면 | 사용자 최종 선택 |

| 민감 관심 없음 | Guest 민감 관심 | 자동 병합 금지 | 별도 설정 확인 |

| Member 추론만 있음 | Guest 명시 관심 | Guest 명시값 우선 후보 | 사용자 확인 |

# 부록 E. 외부 유입 보호 체크리스트

- [ ] 딥링크 첫 화면이 Issue 자체인가?
- [ ] 첫 투표 전에 관심사 Prompt가 나타나지 않는가?
- [ ] 첫 투표 전에 가입을 요구하지 않는가?
- [ ] 관심사 Prompt가 결과와 다음 Issue 행동을 가리지 않는가?
- [ ] Prompt를 닫으면 같은 세션에 반복되지 않는가?
- [ ] Guest가 선택하지 않아도 피드가 계속 동작하는가?
- [ ] 유입 채널별 첫 투표 전환을 측정하는가?
- [ ] Interest Completion 증가와 함께 First Vote Guardrail을 보는가?
- [ ] Prompt 로딩이 Issue Interaction Latency를 늘리지 않는가?
- [ ] 추천 Feature 장애가 투표 기능 장애로 전파되지 않는가?
- [ ] 외부 유입이 많은 Issue에만 국소 정책을 적용하는가?
- [ ] 정치·민감 Prompt가 일반 Guest에게 누출되지 않는가?

# 부록 F. Reason Code

## 온보딩

```text
PROMPT_AFTER_ACCEPTED_VOTES
PROMPT_AFTER_FOR_YOU_ENTRY
PROMPT_AFTER_NEGATIVE_FEEDBACK
PROMPT_AFTER_AUTH
PROMPT_USER_REQUESTED
SKIP_USER_DISMISS
SKIP_COOLDOWN
SKIP_FIRST_VALUE_NOT_REACHED
```

## 관심 변경

```text
INTEREST_ADD_ONBOARDING
INTEREST_ADD_MANUAL
INTEREST_ADD_FOLLOW_TOPIC
INTEREST_REMOVE_MANUAL
INTEREST_REDUCE_LESS_TOPIC
INTEREST_INFER_BEHAVIOR
INTEREST_EXPIRE_TIME_DECAY
INTEREST_IMPORT_GUEST
```

## 추천 Source

```text
INTEREST_RETRIEVAL
SEMANTIC_SIMILARITY
TRENDING
FOLLOWING
EXPLORATION
EDITORIAL
FALLBACK
```

# 부록 G. 확정·초기안·미정 요약

## 확정

- 외부 딥링크 첫 투표 전 관심사 선택 금지
- Guest도 로그인 없이 투표와 선택형 관심사 설정 가능
- 관심사 3개 이상 선택 기본 구조
- 명시 관심사와 행동 추론 분리
- Choice 방향 기반 정치 성향 Profile 금지
- 유희형 초기 Feed 강화
- 개인화와 탐색·다양성 병행
- 사용자 부정 피드백 우선
- 추천 재설정·삭제 제공
- 정치·민감 관심 별도 제한

## 설계 기준

- Guest Prompt는 첫 가치 이후
- Guest Profile은 브라우저 단위
- 최대 선택 수 8개 후보
- Prompt Budget과 Cooldown
- Explicit·Behavior·Session 혼합
- Fallback Feed 상시 준비
- Online·Batch Feature 분리

## 초기안

- Guest 3~5 Vote 후 Prompt
- 관심 60 / 인기·신규 25 / 탐색 15
- Exploration 10~20%
- 카드 12~16개
- 세션당 Full-screen Prompt 1회
- 최근 5개 동일 Category 최대 3개

## 미정

- Guest Profile 정확한 보존 기간
- 회원가입 직후 관심사 필수 여부
- 최종 카드 수·표시명·이미지
- 정치 관심 설정 제공 시점
- 미성년자 개인화 범위
- Raw 이벤트 보존 기간
- 명시 관심사의 장기 감쇠 정책

# 최종 요약

WHICH의 관심사 온보딩은 사용자를 막는 설문이 아니라 첫 투표 이후 추천을 개선하는 짧은 선택 경험이다.

```text
외부 유입
→ 가입 없는 첫 Vote
→ Result
→ Next Issue
→ 선택형 관심사 3개
→ 유희·관심·인기·탐색 혼합 Feed
→ 실제 행동으로 Profile 보정
→ 사용자가 직접 수정·재설정
```

가장 중요한 제품 기준은 다음이다.

1. Guest 외부 유입을 관심사 화면으로 막지 않는다.
2. 선택하지 않아도 WHICH를 정상 이용할 수 있다.
3. 초기 피드는 유희·생활·취향 중심으로 첫 참여를 쉽게 만든다.
4. 명시 관심사와 행동 추론을 구분한다.
5. Vote Choice 방향으로 정치·이념 성향을 만들지 않는다.
6. 개인화는 다양성·탐색·안전 정책을 통과해야 한다.
7. `덜 보기`, 숨기기, 재설정과 삭제를 제공한다.
8. Guest→Member 전환 시 기존 설정을 자동 덮어쓰지 않는다.
9. Feature 장애가 첫 투표와 결과 확인을 방해하지 않는다.
10. Interest Completion보다 Guest First Vote Conversion을 우선 Guardrail로 본다.

다음 상세화 문서는 `07_RECOMMENDATION_AND_ML_ARCHITECTURE.md`이며, 이 문서에서 정의한 Interest Profile, Cold-start Feed Contract, Event, Feature, 정치·민감 제한을 실제 Retrieval·Ranking·Re-ranking·Training Pipeline에 연결한다.

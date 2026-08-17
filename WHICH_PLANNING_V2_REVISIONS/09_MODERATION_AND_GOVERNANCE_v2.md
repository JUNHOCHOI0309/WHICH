# WHICH 모더레이션 및 거버넌스 v2.0

- **문서 상태:** 상세 기획 검토본
- **버전:** 2.0
- **기준일:** 2026-08-17
- **기준 문서:**
  - `01_PRODUCT_VISION_AND_PRINCIPLES_v2.md`
  - `02_CORE_UX_AND_USER_JOURNEYS_v2.md`
  - `03_ISSUE_SUPPLY_AND_CONTENT_PIPELINE_v2.md`
  - `04_ISSUE_TAXONOMY_QUALITY_AND_CONTROVERSY_v2.md`
  - `05_IDENTITY_AND_VOTE_INTEGRITY_v2.md`
  - `06_INTEREST_ONBOARDING_AND_PERSONALIZATION_v2.md`
  - `07_RECOMMENDATION_AND_ML_ARCHITECTURE_v2.md`
  - `08_SOCIAL_AND_COMMUNITY_v2.md`
  - `09_MODERATION_AND_GOVERNANCE.md` v1
  - `10_METRICS_ANALYTICS_AND_EXPERIMENTS.md`
  - `11_MVP_ROADMAP_AND_OPEN_DECISIONS.md`
  - `13_GLOSSARY_AND_STATUS_MODEL.md`
- **문서 목적:** WHICH에서 생성·수집·게시·추천·투표·댓글·프로필·신고되는 모든 객체에 대해 허용 범위, 위험 분류, 자동·인간 검수, 제한·삭제·복구, 정치·선거 세이프라인, 피해자·미성년자 보호, 운영 권한, 감사, 이의 제기, 투명성 보고를 하나의 운영 계약으로 정의한다.
- **문서 비범위:** 최종 법률의견, 국가별 서비스 약관 최종본, 물리 DB DDL, 최종 모더레이션 모델 선정, 고객지원 인력 채용계획, 경찰·법원·선거관리기관 요청에 대한 개별 사건 판단은 후속 법률·보안·데이터 설계에서 확정한다.
- **중요 고지:** 이 문서는 제품·운영 설계안이며 법률 자문이 아니다. 특히 정치·선거, 아동·청소년, 개인정보, 명예훼손, 저작권, 수사기관 요청은 출시 국가의 변호사와 관할 기관 검토를 거쳐야 한다.

---

## 0. 결정 상태 표기

| 표기 | 의미 |
|---|---|
| **[확정]** | 후속 UX·DB·API·추천·운영 설계의 기본 전제로 사용한다. |
| **[설계 기준]** | 원칙은 채택하되 세부 구현과 수치는 실제 운영 데이터로 조정할 수 있다. |
| **[초기안]** | MVP 또는 초기 실험용 가설이며 출시 전 운영·법률·보안 검증이 필요하다. |
| **[미정]** | 별도 제품·기술·법률 의사결정을 거쳐야 한다. |
| **[금지]** | 제품 정체성, 안전, 개인정보, 정치 세이프라인을 해치므로 채택하지 않는다. |
| **[법률 확인 필요]** | 제품팀이 단독 확정하지 않고 관할 법률 검토가 필요한 항목이다. |
| **[벤치마크]** | 다른 제도·플랫폼에서 참고한 운영 원리이며 WHICH에 법적 의무로 자동 적용되는 것은 아니다. |

### 0.1 v2 주요 보강 내용

| 영역 | v1 | v2 보강 내용 |
|---|---|---|
| 범위 | Issue·Comment·User 중심 | Profile·Source·Vote·Reaction·Follow·Recommendation·Legal Request·Model Decision까지 객체별 정책화 |
| 정책 구조 | 위험 항목 나열 | 정책 Domain, Severity, Confidence, Reach, Vulnerability, Election Sensitivity의 다축 판정 |
| 제재 | 허용·숨김·삭제 | Remove·Reduce·Inform·Limit·Freeze·Suspend를 분리한 다차원 Enforcement Ladder |
| Issue | 게시 전 검수 | 첫 정상 투표 이후 의미 불변성, 결과 잠금, 정정·Successor·Archive 계약 |
| 댓글 | 자동 검사·삭제 | A/B 문맥, Thread 상태, Slow Mode, Side-targeted Harassment, 작성자 보호와 복구 |
| 신고 | 이유와 신뢰도 | Guest 신고, 조직적 신고 방어, 긴급 신고, Reporter Reliability, 신고자 안전 |
| AI | 분류 보조 | Structured Output, Confidence·Uncertainty, Human Review Threshold, Bias QA, Drift·Rollback |
| 인간 운영 | Queue | 역할 분리, 2인 승인, Conflict of Interest, Reviewer Wellness, QA Sampling, SLA |
| 정치 | 별도 검수 | 정치와 선거 분리, Election Mode, 모의·인기투표 법률 위험, 결과 공표 Freeze, Fail-Closed |
| 개인정보 | 일부 보호 | 정치적 견해·건강·성생활 등 민감정보, 자동화 결정 설명·재검토, 최소 접근·보존 정책 |
| 아동·청소년 | 후속 | General Audience 기본, 14세 미만 가입 제한 초기안, 미성년자·피해자 식별 정보 보호 |
| 투명성 | Audit | 이용자 통지, Reason Code, Appeal, Policy Change Log, Transparency Report |
| 사고대응 | 좌표찍기 중심 | SEV 분류, Threat·Doxxing·Election·Model Failure·Moderator Abuse Playbook |
| Guest | 별도 언급 없음 | LOW 안전 Issue의 외부 첫 투표를 모더레이션 마찰이 불필요하게 감소시키지 않는 Guardrail |

### 0.2 핵심 결정 요약

1. **[확정]** WHICH는 의견 자체가 아니라 `불법·피해·기만·조작·권리침해를 만드는 표현과 행동`을 관리한다.
2. **[확정]** 질문·A/B 선택지·배경·출처·투표 무결성·댓글·추천 노출을 하나의 연결된 거버넌스 대상으로 본다.
3. **[확정]** 안전·법률·정치·무결성 정책은 Engagement와 추천 모델 점수보다 우선한다.
4. **[확정]** 신고 수만으로 콘텐츠를 자동 삭제하지 않는다.
5. **[확정]** 동일한 정책 위반이라도 객체, 피해 가능성, 확산 규모, 반복성, 취약 대상 여부에 따라 조치를 다르게 적용한다.
6. **[확정]** 게시 가능한지, 추천 가능한지, 댓글·공유가 가능한지, 결과를 공개할지는 서로 다른 판단이다.
7. **[설계 기준]** 명백한 중대 위반은 자동 차단할 수 있지만, 애매하거나 맥락 의존적인 사건은 인간 검수를 거친다.
8. **[확정]** HIGH·RESTRICTED, 정치·선거, 미성년자·피해자, 개인정보, 대량 무효화는 인간 승인 없이 최종 처리하지 않는다.
9. **[확정]** 첫 정상 투표 이후 질문과 A/B의 핵심 의미는 바꾸지 않는다. 의미가 바뀌면 기존 Issue를 종료하고 Successor를 생성한다.
10. **[확정]** 일반 LOW Issue의 외부 Guest 첫 투표는 로그인·관심사·모더레이션 Prompt로 차단하지 않는다.
11. **[설계 기준]** 위험이 낮은 Guest에게 일괄 CAPTCHA·전면 경고를 적용하지 않고 Risk-proportional Friction을 사용한다.
12. **[확정]** 댓글의 A/B 방향은 정책 위반 판정이나 품질 점수의 긍정·부정 근거가 아니다.
13. **[확정]** 조직적 신고와 좌표찍기는 Target 자동 삭제가 아니라 신고 Cluster·투표 Cluster를 분리해 검토한다.
14. **[확정]** 정치와 선거는 같은 용어로 묶지 않는다. 선거 후보·정당 지지도·당선 예측·모의투표·인기투표는 별도 Election Policy를 적용한다.
15. **[확정]** 정치·선거 투표와 댓글은 MVP 기본 비활성이다.
16. **[법률 확인 필요]** 대한민국 공직선거법상 선거 관련 모의투표·인기투표와 결과 공표 규정이 WHICH에 적용될 가능성을 전제로, 선거 기능은 법률 검토 전 활성화하지 않는다.
17. **[확정]** “대표 여론이 아니다”라는 고지만으로 선거 관련 법률 의무가 사라진다고 가정하지 않는다.
18. **[확정]** 정치 A/B 선택을 공개 Profile, 추천 성향, 정당·후보 지지 추론에 사용하지 않는다.
19. **[확정]** 개인정보·정치적 견해·미성년자 관련 데이터는 최소 수집, 목적 제한, 접근 분리, 보존 최소화를 적용한다.
20. **[설계 기준]** 사용자 권리·계정에 중대한 영향을 주는 완전 자동화 제재는 설명·인간 재검토·이의 제기 경로를 제공한다.
21. **[확정]** 모든 주요 조치는 Policy Version, Reason Code, Evidence Snapshot, Actor, 승인 체인을 Audit한다.
22. **[확정]** Appeal이 받아들여지면 콘텐츠·Count·Reputation·추천 Feature·학습 Label까지 복구한다.
23. **[확정]** 모더레이터의 개인정보·정치 선택 대량 조회와 Production 직접 수정 권한을 제한한다.
24. **[설계 기준]** 공개 Transparency Report는 제거 수만이 아니라 복구율·Appeal 결과·자동화 사용·정책 오류를 함께 보고한다.
25. **[금지]** 유희성·논쟁성·바이럴을 이유로 모욕, 혐오, 허위 전제, 피해자 소비, 정치 조작을 정당화하지 않는다.

---

# 1. 문서의 역할과 거버넌스 문제

## 1.1 WHICH에서 모더레이션이 어려운 이유

WHICH의 핵심 콘텐츠는 긴 게시글이 아니라 다음의 짧은 구조다.

```text
질문
+
A 선택지
+
B 선택지
+
배경·출처
+
투표 결과
+
댓글
```

짧기 때문에 참여는 쉽지만, 몇 단어의 편향이 전체 결과를 왜곡할 수 있다.

예:

```text
세금을 낭비하는 정책을 계속해야 할까?

A. 계속해야 한다
B. 중단해야 한다
```

이 질문은 욕설이 없더라도 `세금을 낭비하는`이라는 허위 또는 미검증 전제를 포함하고, A를 비합리적인 선택처럼 만든다.

WHICH의 모더레이션은 따라서 단순 금칙어 필터가 아니라 다음을 함께 판단해야 한다.

- 질문의 전제가 검증 가능한가
- A와 B의 표현 강도가 대등한가
- 특정 집단을 공격 대상으로 만드는가
- 실존 개인의 명예·안전·사생활을 침해하는가
- 결과가 대표 여론처럼 오해될 위험이 있는가
- 투표·신고·공감·댓글이 조직적으로 조작되는가
- 추천 알고리즘이 위험 콘텐츠를 증폭하는가
- 운영자가 개입한 이유를 추적하고 복구할 수 있는가

## 1.2 거버넌스의 한 줄 목표

> 사용자가 다양한 의견을 안전하게 선택하고 비교할 수 있게 하되, 질문 설계·행동 조작·피해 유발·정치적 동원이 제품의 성장 엔진이 되지 않도록 한다.

## 1.3 이해관계자별 가치

### 참여자

- 명확하고 대등한 질문
- 투표 전 조작되지 않은 선택 경험
- 결과의 집계 상태와 한계 이해
- 같은 의견과 다른 의견의 안전한 탐색
- 불쾌·위험 콘텐츠의 숨김·신고·차단
- 잘못된 자동 제재에 대한 설명과 재검토

### Creator

- 게시 가능한 기준을 사전에 이해
- AI 수정 제안으로 중립적 질문 작성
- 거절·제한 사유와 수정 방법 확인
- 오탐 제재에 대한 Appeal
- 정상 성과와 조작 성과의 분리

### 운영자

- 위험도와 우선순위가 정리된 Queue
- 일관된 Reason Code와 Evidence
- 대량 조치의 승인·복구
- 모델 오류·조직적 공격·법적 요청의 분리
- 투명성 보고에 사용할 집계 데이터

### 사회·외부 이해관계자

- WHICH 결과가 대표 여론으로 과장되지 않음
- 선거·정치 조작 억제
- 피해자·미성년자·취약 집단 보호
- 법적 요청과 플랫폼 정책 조치의 구분
- 정책 변경과 주요 사고에 대한 책임성

## 1.4 비목표

WHICH 모더레이션은 다음을 목표로 하지 않는다.

- 모든 논쟁이나 불쾌함 제거
- 운영자가 사실·도덕의 최종 권위가 되는 것
- A와 B의 지지율을 원하는 방향으로 조정하는 것
- 신고가 많은 의견을 자동 제거하는 것
- 정치적 중립을 명목으로 모든 공공 논의를 금지하는 것
- 사용자별 정치·이념 성향 데이터베이스 구축
- AI 모델 하나로 모든 판단 자동화
- 범죄수사기관 역할 수행
- 법률 검토 없는 선거 인기투표 운영

---

# 2. 적용 범위와 객체 모델

## 2.1 관리 대상 객체

```text
Source
Source Item
Issue Candidate
Published Issue
Choice A / Choice B
Background / Citation
Vote Attempt
Accepted Vote
Vote Cluster
Comment
Reply
Reaction
Profile
Display Name / Handle / Avatar / Bio
Creator
Follow
Topic
Report
Appeal
Recommendation Exposure
Notification
Moderation Decision
Legal Request
AI Model Output
Audit Record
```

## 2.2 객체별 주요 위험

| 객체 | 주요 위험 |
|---|---|
| Source | 허위·철회·오역·권리 불명확 |
| Issue Candidate | 유도 질문, 다중 논점, 중복, 위험 분류 누락 |
| Published Issue | 허위 전제, 실존 개인 공격, 정치·선거 법률 위험 |
| Choice | 비대칭, 모욕적 선택지, 필수 제3선택 누락 |
| Vote | 중복, 봇, 좌표찍기, 결과 왜곡 |
| Comment | 혐오, 괴롭힘, 위협, 개인정보, 스팸 |
| Profile | 사칭, 모욕적 닉네임, 외부 개인정보, 성적 이미지 |
| Reaction | 공감 Farm, 다중 계정, Majority Domination |
| Follow | Follow Farm, Creator 성과 조작 |
| Report | 조직적 신고, 허위 신고, 보복 신고 |
| Recommendation | 위험 콘텐츠 증폭, 정치 과다 노출, 필터버블 |
| Notification | 분노 재참여, 상대편 공격 동원 |
| AI Decision | 편향, 오탐, 설명 불가, Drift |
| Moderator Action | 권한 남용, 일관성 부족, 정치적 편향 |

## 2.3 독립적인 상태 축

한 객체의 상태를 하나의 `status`에 모두 넣지 않는다.

```text
Publication State
+
Moderation State
+
Visibility State
+
Integrity State
+
Legal State
+
Appeal State
```

예:

```text
Issue
Publication: PUBLISHED
Moderation: UNDER_REVIEW
Visibility: SEARCH_HIDDEN
Integrity: ANOMALY_DETECTED
Legal: NONE
Appeal: NOT_APPLICABLE
```

## 2.4 정책과 법률 조치 분리

```text
POLICY_ENFORCEMENT
LEGAL_ENFORCEMENT
PRIVACY_REQUEST
COPYRIGHT_REQUEST
SECURITY_RESPONSE
INTEGRITY_RESPONSE
```

사용자에게도 가능한 범위에서 조치의 성격을 구분한다.

예:

- 커뮤니티 정책 위반으로 삭제됨
- 개인정보 보호 요청에 따라 비공개 처리됨
- 유효한 법적 요청에 따라 해당 지역에서 제한됨
- 투표 무결성 검토로 결과 표시가 잠김

---

# 3. 핵심 거버넌스 원칙

## 3.1 의견과 피해 행동을 구분한다

**[확정]** 다음은 허용될 수 있다.

- 인기 없는 의견
- 다수와 반대되는 의견
- 정책·기업·공인에 대한 비판
- 종교·철학·문화에 대한 논쟁적 의견
- 특정 제도를 폐지하거나 강화하자는 주장

다음은 별도로 제한한다.

- 폭력 위협
- 특정 개인을 향한 집단 괴롭힘
- 혐오·비인간화
- 개인정보 노출
- 사칭·사기
- 허위 전제에 기반한 조작 질문
- 조직적 투표·신고·공감 조작

## 3.2 질문은 댓글보다 먼저 검수한다

질문 자체가 편향되면 정상적인 댓글과 투표도 왜곡된다.

```text
질문 품질·안전 Gate
→ 게시 Eligibility
→ 투표
→ 댓글
```

댓글 모더레이션만 강화하고 질문을 방치하지 않는다.

## 3.3 사실과 의견을 분리한다

```text
Background
= 검증 가능한 사실·맥락

Question + A/B
= 사용자의 판단·선호
```

의견 질문은 자유로울 수 있지만 배경 사실은 Source와 시점을 가져야 한다.

## 3.4 위험에 비례한 마찰

```text
LOW
→ 자동 검사 중심, Guest 즉시 참여

MEDIUM
→ 품질·안전 검사 강화

HIGH
→ 인간 검토, 권한 제한 후보

RESTRICTED
→ 별도 Queue, Fail-Closed, 운영 승인
```

LOW 안전 Issue의 외부 첫 투표를 보호하기 위해 모든 Guest에게 일괄 경고·CAPTCHA·로그인을 적용하지 않는다.

## 3.5 Remove만이 답은 아니다

가능한 조치:

```text
ALLOW
INFORM
LABEL
DEPRIORITIZE
LIMIT_FEATURES
HIDE_FROM_RECOMMENDATION
HOLD_FOR_REVIEW
FREEZE_INTERACTION
REMOVE
SUSPEND
```

위반이 아니지만 민감하거나 맥락이 필요한 콘텐츠는 삭제 대신 설명·연령·노출 제한을 사용할 수 있다.

## 3.6 모델보다 정책이 우선한다

```text
Policy Eligibility
→ ML Ranking
→ Policy Re-ranking
→ Final Feed
```

추천 점수, 투표 수, 댓글 수, 공유 수는 정책 위반을 면제하지 않는다.

## 3.7 신고 수보다 증거와 맥락

```text
Report Volume
≠
Policy Violation
```

신고는 검토 신호이며 최종 판정이 아니다.

## 3.8 사용자 통지와 복구

중대한 제한에는 다음을 제공한다.

- 대상 콘텐츠
- 적용된 정책 범주
- 취한 조치
- 조치 기간
- 다음 행동
- Appeal 가능 여부

보안 탐지 Threshold와 공격 방어 정보는 공개하지 않을 수 있다.

## 3.9 감사 가능성

모든 주요 결정은 다음 질문에 답할 수 있어야 한다.

```text
누가
언제
무엇을
어떤 정책 버전으로
어떤 증거를 보고
무슨 조치를 했고
누가 승인했으며
어떻게 복구할 수 있는가
```

## 3.10 정책의 공개와 변경 관리

정책은 내부 비밀 규칙만으로 운영하지 않는다.

- 공개 커뮤니티 기준
- 주요 예시
- 시행일
- 변경 이력
- 중대한 변경의 사전 고지 후보
- 내부 상세 Rule과 공개 설명의 연결

---

# 4. 다축 위험 판정 모델

## 4.1 판정 축

각 사건은 다음 축으로 평가한다.

```text
Policy Domain
Severity
Confidence
Reach
Immediacy
Target Vulnerability
Repeat / Coordination
Election Sensitivity
Reversibility
```

## 4.2 Severity

| 등급 | 의미 | 예 |
|---|---|---|
| S0 | 위반 없음 | 불쾌하지만 허용되는 의견 |
| S1 | 경미 | 품질 저하, 경미한 스팸, 불필요한 공격성 |
| S2 | 중간 | 반복 괴롭힘, 허위 전제, 사칭 후보 |
| S3 | 중대 | 명시적 혐오, 개인정보 노출, 폭력 찬양 |
| S4 | 긴급·치명 | 구체적 위협, 아동 성착취, 즉각적 위해, 선거 중대 사고 |

## 4.3 Confidence

```text
C0  정보 부족
C1  낮음
C2  중간
C3  높음
C4  사실상 확실
```

낮은 Confidence에서 비가역적 제재를 피한다.

## 4.4 Reach

| 등급 | 범위 |
|---|---|
| R0 | Draft·미노출 |
| R1 | 소수 사용자 |
| R2 | 일반 공개 |
| R3 | 인기·추천·외부 공유 |
| R4 | 대규모 바이럴·언론·선거 영향 가능 |

## 4.5 Immediacy

```text
I0  즉각적 위해 없음
I1  단기 악화 가능
I2  빠른 확산 가능
I3  즉각적 생명·신체·선거·개인정보 위험
```

## 4.6 Target Vulnerability

가중 대상:

- 미성년자
- 범죄·재난 피해자와 유가족
- 비공인 개인
- 신체·정신 건강 위기 사용자
- 개인정보 노출 대상
- 성적 이미지 피해자
- 차별 대상 집단
- 선거 후보가 아닌 일반 가족·관계자

## 4.7 Coordination

```text
NONE
SUSPECTED
COORDINATED
AUTOMATED
STATE_OR_CAMPAIGN_RISK
```

마지막 값은 내부 위험 분류이며 외부 공개 라벨로 자동 사용하지 않는다.

## 4.8 최종 Priority 개념

```text
Priority
=
Severity
× Confidence
× Reach
× Immediacy
× Vulnerability
× Coordination
× Election Sensitivity
```

실제 계산은 단순 곱셈이 아니라 Rule과 Score의 혼합으로 구현한다.

## 4.9 Hard Escalation

다음은 총점과 관계없이 Critical Queue로 보낸다.

- 구체적인 폭력·살해·자살 위험
- 아동 성착취물 또는 의심 자료
- 비동의 성적 이미지
- 주민등록번호·계좌·정밀 주소 등 중대한 개인정보
- 선거일·후보·정당 관련 법률 Freeze 대상
- 대규모 결과 조작
- 운영자 권한 남용
- 개인정보·정치 선택 대량 유출
- 법원·수사기관의 긴급 적법 요청 후보

---

# 5. Enforcement의 다차원 구조

## 5.1 콘텐츠 적격성

```text
ELIGIBLE
CONTEXT_REQUIRED
LIMITED
INELIGIBLE
REMOVED
```

## 5.2 공개 가시성

```text
PUBLIC
PROFILE_ONLY
DIRECT_LINK_ONLY
SEARCH_HIDDEN
RECOMMENDATION_HIDDEN
COLLAPSED
HIDDEN
```

## 5.3 기능 제한

```text
COMMENTS_OFF
REACTIONS_OFF
SHARING_OFF
EDITING_OFF
VOTING_PAUSED
RESULTS_LOCKED
RANKING_FROZEN
NOTIFICATIONS_OFF
```

## 5.4 계정 상태

```text
NORMAL
WARNING
COMMENT_COOLDOWN
POSTING_COOLDOWN
CREATOR_PREMODERATION
READ_ONLY
LIMITED
SUSPENDED
TERMINATED
```

## 5.5 결과·집계 상태

```text
NORMAL
LOW_SAMPLE
UNDER_REVIEW
DISPLAY_LOCKED
CORRECTED
CLOSED
```

## 5.6 제재 선택 원칙

| 상황 | 우선 조치 |
|---|---|
| 품질이 낮지만 위반 아님 | 수정 제안·추천 제외 |
| 민감하지만 공익 맥락 존재 | 라벨·노출 제한·기능 제한 |
| 반복 스팸 | Rate Limit·Cooldown·삭제 |
| 특정 사용자 괴롭힘 | 댓글 제거·Block 지원·계정 제한 |
| 개인정보 노출 | 즉시 Hide·캐시 제거·Escalation |
| 투표 이상 | 추천 동결·결과 잠금·Vote Review |
| 정치·선거 법률 위험 | Fail-Closed·법률 검토·게시/결과 중단 |
| 긴급 신체 위험 | 즉시 Escalation·증거 보존·현지 절차 검토 |

## 5.7 사용자 선택과 Enforcement 분리

```text
A를 선택함
≠
위험 사용자

B를 선택함
≠
신뢰 사용자
```

정책 위반 판정은 선택 방향이 아니라 표현·행동·조작 근거에 기반한다.

---

# 6. 정책 Taxonomy 개요

## 6.1 Policy Domain 코드

```text
ILLEGAL_CONTENT
VIOLENCE_THREATS
SELF_HARM_CRISIS
HATE_DISCRIMINATION
HARASSMENT_BULLYING
PRIVACY_DOXXING
SEXUAL_EXPLOITATION
CHILD_SAFETY
MISINFORMATION_FALSE_PREMISE
IMPERSONATION_FRAUD
SPAM_MANIPULATION
PLATFORM_CIRCUMVENTION
INTELLECTUAL_PROPERTY
SOURCE_INTEGRITY
ELECTION_POLITICS
PROFILE_IDENTITY
QUALITY_NONVIOLATING
LEGAL_REQUEST
```

## 6.2 위반과 품질 문제 분리

### 정책 위반

- 삭제·제한·계정 조치 가능
- Appeal 대상
- Reputation 영향 후보
- 반복 위반 누적 가능

### 품질 문제

- 중립성 부족
- A/B 비대칭
- 불명확
- 중복
- 낮은 유희성
- 과도한 길이

품질 문제는 기본적으로 정책 Strike가 아니다.

## 6.3 하나의 사건에 여러 코드

예:

```text
특정 일반인의 집 주소를 공개하며
사람들에게 항의하러 가라고 요청
```

가능 코드:

```text
PRIVACY_DOXXING
HARASSMENT_BULLYING
VIOLENCE_THREATS 후보
COORDINATED_BEHAVIOR
```

주 코드와 보조 코드를 모두 기록한다.

---

# 7. 불법 콘텐츠와 긴급 안전

## 7.1 기본 원칙

WHICH는 불법 여부를 모든 상황에서 독자적으로 확정하지 않는다.

```text
명백한 플랫폼 정책 위반
→ 정책 조치

법률 해석이 필요한 사건
→ Legal Queue

즉각적 위해
→ Emergency Procedure
```

## 7.2 즉시 제한 후보

- 아동 성착취 자료
- 비동의 성적 이미지
- 구체적 폭력·살해 위협
- 테러·대규모 위해의 실행 지시
- 마약·무기·사기 등 명백한 불법 거래 연결
- 주민등록번호·금융 인증정보
- 법원 명령 등 유효한 긴급 요청

## 7.3 증거 보존

긴급 삭제 전에 가능한 범위에서 다음을 보존한다.

- 원본 Object Version
- 작성자·시간·Source
- 탐지 이유
- 신고 정보
- 접근 로그 Reference
- Hash·Snapshot
- 삭제·제한 Actor

증거 보존이 피해 콘텐츠의 장기 복제를 의미하지 않도록 접근을 분리한다.

## 7.4 외부 기관 연락

**[법률 확인 필요]** 생명·신체의 즉각적 위험, 아동 안전, 수사기관 요청은 관할 국가의 법률과 회사 절차에 따라 처리한다.

운영자가 임의로 개인정보를 외부에 제공하지 않는다.

## 7.5 긴급 사용자 UX

일반 사용자에게 구체적 내부 조사 정보를 공개하지 않는다.

```text
안전상의 이유로 이 콘텐츠를 확인할 수 없습니다.
```

작성자에게는 가능한 범위에서 정책 범주와 Appeal 경로를 안내한다.

---

# 8. 폭력·위협·위기 콘텐츠

## 8.1 위협 분류

| 유형 | 예 | 기본 처리 |
|---|---|---|
| 일반적 과장·관용구 | “진짜 화나 죽겠다” | 맥락 확인 |
| 비구체적 공격성 | “혼나야 한다” | 품질·괴롭힘 검토 |
| 특정 대상 위협 | “내일 찾아가겠다” | 긴급 검토 |
| 구체적 수단·시간 | 장소·수단·시간 명시 | Critical |
| 집단 폭력 선동 | 특정 집단 공격 지시 | 제거·계정 조치 |

## 8.2 폭력 논의와 폭력 조장 구분

허용 가능:

- 뉴스·정책 맥락의 폭력 사건 논의
- 역사·교육 목적
- 피해 예방 정보
- 영화·게임의 허구적 폭력 취향 질문

제한:

- 실제 공격 방법 안내
- 특정 대상 공격 지시
- 피해 장면의 유희화
- 범죄 피해자 조롱

## 8.3 자해·자살 위험

WHICH의 A/B 형식으로 다음 질문을 만들지 않는다.

```text
살아야 한다 vs 죽어야 한다
자해해도 된다 vs 안 된다
```

자해·자살 관련 콘텐츠는 투표형 유희로 처리하지 않는다.

위기 신호가 있는 댓글은 다음을 검토한다.

```text
긴급 위험
→ 공개 노출 제한
→ 인간 검토
→ 지역별 도움 자원 안내 후보
→ 법률·안전 절차
```

## 8.4 피해 사건 유희화 금지

- 실제 사망·재난을 밸런스 게임으로 변환 금지
- 피해자 책임을 A/B 오락으로 묻지 않음
- 유가족·미성년 피해자의 신원 노출 금지
- 사건이 공익 논의 대상이라면 정책·예방·제도 질문으로 좁힘

---

# 9. 혐오·차별·비인간화

## 9.1 보호 대상 정책

**[설계 기준]** 법률상 정의와 별개로 WHICH는 다음 특성을 이유로 집단을 열등·위험·비인간적으로 묘사하거나 배제를 선동하는 콘텐츠를 제한한다.

- 인종·민족·국적
- 종교·신념
- 성별·성적 지향·성별 정체성
- 장애·질병
- 출신 지역·계층
- 연령
- 기타 역사적으로 차별 위험이 큰 특성

정치적 입장·직업·팬덤에 대한 모든 비판을 보호 대상 혐오로 자동 분류하지 않는다. 다만 표적 괴롭힘은 별도 정책을 적용한다.

## 9.2 허용 가능한 정책 논의

허용 가능:

- 차별 제도의 찬반 논의
- 종교·문화 관행 비판
- 이민·복지·교육 정책 토론
- 차별적 발언을 비판하기 위한 인용

조건:

- 특정 집단의 인간성 부정 금지
- 폭력·추방·권리 박탈 선동 금지
- 허위 통계·전제 검증
- A/B 선택지의 모욕성 대칭 금지

## 9.3 금지 질문 예

```text
○○ 집단은 사회에 필요 없는 존재인가?

A. 그렇다
B. 아니다
```

질문 자체가 집단의 존엄과 존재를 오락적 선택으로 만든다.

## 9.4 세대·지역·젠더 유희의 경계

유희성으로 허용하지 않는다.

```text
어느 지역 사람이 더 무개념인가?
남자와 여자 중 누가 더 이기적인가?
어느 세대가 사회를 망쳤는가?
```

생활 공감형으로 좁힐 수 있다.

```text
직장 내 세대별 소통 방식을 별도 교육할 필요가 있을까?
```

---

# 10. 괴롭힘·모욕·표적 공격

## 10.1 대상 구분

| 대상 | 보호 강도 |
|---|---|
| 비공인 개인 | 매우 높음 |
| 미성년자 | 최고 수준 |
| 피해자·유가족 | 최고 수준 |
| 공인·기업·기관 | 정책·행위 비판 허용, 위협·사생활 침해 제한 |
| 익명 Creator | 반복 추적·집중 공격 제한 |

## 10.2 정책 비판과 인신공격

허용 가능:

```text
○○ 기업의 환불 정책은 불공정하다고 생각한다.
```

제한 후보:

```text
○○ 직원은 인간 쓰레기다. 찾아가서 항의하자.
```

## 10.3 반복성과 집중성

단일 문장만 보지 않고 다음을 본다.

- 여러 Issue에 따라다니며 공격
- 여러 계정이 한 Creator에 집중
- 차단 우회
- 개인정보와 결합
- 외부 커뮤니티의 공격 지시
- Reply·신고·공감의 동시 Burst

## 10.4 Side-targeted Harassment

```text
A 선택자 전부 정신병자다.
B를 고른 사람은 해고해야 한다.
```

A/B 선택 집단을 향한 모욕·불이익 선동은 댓글 정책 위반 후보로 처리한다.

## 10.5 공인 관련 질문

공인의 정책·공적 행위는 질문할 수 있다.

다음은 제한한다.

- 확인되지 않은 범죄 단정
- 사적 가족·미성년 자녀 공격
- 외모·질병·성생활 유희화
- 주소·연락처 공개
- 폭력·괴롭힘 동원

---

# 11. 개인정보·Doxxing·사생활 침해

## 11.1 개인정보 유형

### 즉시 제한 후보

- 주민등록번호·여권번호·운전면허번호
- 계좌·카드·인증번호
- 정확한 자택 주소
- 실시간 위치
- 개인 전화번호·사적 이메일
- 의료 기록
- 미성년자의 학교·동선
- 비공개 성적 이미지

### 맥락 검토

- 공개된 회사 대표번호
- 공직자의 공식 업무 연락처
- 공공기관 주소
- 언론에 공개된 공적 정보
- 사용자가 직접 공개한 일반 Profile 정보

공개되어 있다는 이유만으로 재배포와 표적화를 무조건 허용하지 않는다.

## 11.2 Doxxing 판정

```text
개인 식별 정보
+
비공개 또는 민감 맥락
+
피해·괴롭힘·추적 가능성
```

이 세 요소를 함께 본다.

## 11.3 즉시 Hide 절차

```text
Detect / Report
→ 즉시 공개 Hide 후보
→ Cache·Search 제거
→ Human Review
→ 피해자 통지 후보
→ 재게시 방지
→ Account Action
```

## 11.4 피해자 우선 UX

피해자는 다음을 사용할 수 있어야 한다.

- 긴급 개인정보 신고
- 본인임을 입증할 최소 절차
- 검색·캐시 제거 요청
- 관련 계정 차단
- 사건 진행 상태
- 추가 자료 제출

피해자가 전체 커뮤니티 신고 절차를 반복하지 않도록 별도 Privacy Channel을 둔다.

## 11.5 정치 선택과 민감정보

대한민국 개인정보 보호법은 정치적 견해를 민감정보 범주로 다룬다. 따라서 정치 A/B 선택을 다음에 사용하지 않는다.

- 공개 Profile
- 광고 Targeting
- 정당·후보 선호 추론
- 일반 직원의 자유로운 조회
- 세밀한 지역별 정치 성향 분석
- 제3자 판매·공유

## 11.6 Moderation Evidence의 개인정보

Evidence Snapshot은 원문을 무조건 복제하지 않는다.

```text
필요 최소 필드
+
접근 권한
+
보존 기간
+
Incident Hold
```

을 적용한다.

---

# 12. 성적 콘텐츠·착취·비동의 이미지

## 12.1 General Audience 원칙

WHICH의 일반 Feed는 성인물 소비 플랫폼이 아니다.

- 노골적 성적 이미지 금지
- 포르노 링크 금지
- 성행위 묘사 중심 질문 제한
- 성적 서비스 거래 금지
- 비동의 성적 이미지 금지
- 미성년자 성적 대상화 절대 금지

## 12.2 관계·성교육 논의

다음은 맥락상 허용될 수 있다.

- 연애 경계
- 동의
- 피임·성건강의 일반 정보
- 미디어 표현에 대한 정책 질문
- 성교육 정책

조건:

- 노골적 묘사 최소화
- 의료·교육 Source
- 미성년자 대상 질문 신중 처리
- 개인 경험 강요 금지
- 피해자 신원 노출 금지

## 12.3 비동의 성적 이미지

의심 단계에서도 우선 공개를 차단하고 전문 Queue로 보낸다.

```text
HIDE
→ Evidence Access 제한
→ Senior Review
→ Hash·재업로드 방지 후보
→ 피해자 지원·법률 절차
```

## 12.4 성적 굴욕형 밸런스 게임 금지

```text
누가 더 성적으로 문란한가?
어느 집단이 연애 상대로 최악인가?
```

같은 질문은 유희성으로 허용하지 않는다.

---

# 13. 아동·청소년 안전

## 13.1 기본 정책

아동·청소년 관련 콘텐츠에는 `최선의 이익`, 연령에 맞는 설명, 개인정보 최소화를 우선한다.

## 13.2 MVP 연령 정책 초기안

**[초기안]** 법정대리인 동의·연령 확인·삭제 요구 체계가 준비되기 전에는 다음을 권고한다.

```text
Member 가입
→ 만 14세 이상

14세 미만
→ 계정 생성 비활성
```

Guest는 연령을 확정하기 어려우므로 일반 공개 Feed를 청소년에게도 부적절하지 않은 수준으로 유지한다.

## 13.3 연령 제한 Surface

성인·고위험 콘텐츠가 향후 허용되면 다음이 필요하다.

```text
로그인
+
연령 확인
+
Age-gated Surface
+
추천 분리
```

일반 Guest Feed에 혼합하지 않는다.

## 13.4 미성년자 식별 정보

금지 또는 즉시 제한:

- 학교·학급·시간표·동선
- 얼굴과 정확한 위치 조합
- 연락처
- 가족 갈등의 구체적 신원
- 성적 이미지·성적 대상화
- 범죄 피해 미성년자의 신원

## 13.5 학교·교육 질문

다음처럼 제도 중심으로 설계한다.

```text
학생의 스마트폰 사용을 수업 중 제한해야 할까?
```

다음은 금지 후보다.

```text
이 학교의 특정 학생은 퇴학시켜야 할까?
```

## 13.6 아동의 개인정보 권리

**[법률 확인 필요]** 대한민국 개인정보 보호법은 14세 미만 아동의 개인정보 처리와 법정대리인 권리를 별도로 다룬다. 가입 연령, 동의, 열람·정정·삭제 절차는 출시 전 법률 검토를 거친다.

---

# 14. 허위정보·왜곡 전제·Source Integrity

## 14.1 WHICH의 허위정보 정책 범위

모든 틀린 의견을 삭제하는 정책이 아니다.

다음에 집중한다.

- 질문의 핵심 전제가 검증 가능한 사실인데 거짓임
- Source가 내용을 지지하지 않음
- 날짜·수치·주체를 왜곡함
- 풍자·합성물을 실제 자료처럼 사용함
- 정정된 내용을 계속 유지함
- 건강·안전·선거에 중대한 피해를 줄 수 있음

## 14.2 사실·해석·예측 구분

```text
FACT
INTERPRETATION
OPINION
PREDICTION
SATIRE
UNVERIFIED_CLAIM
```

Candidate와 Background의 Claim마다 유형을 붙일 수 있다.

## 14.3 허위 전제 예

```text
정부가 모든 직장인의 메신저를 감시하기로 했다.
이 정책에 찬성하는가?
```

실제 정책이 없다면 질문 전체를 게시하지 않는다.

## 14.4 Source 역할

| Source Class | 역할 |
|---|---|
| OFFICIAL | 정책·통계·결정 원문 |
| PRIMARY | 당사자 발언·원자료 |
| MAJOR_MEDIA | 배경·검증·맥락 |
| SECONDARY | 보조 해설 |
| COMMUNITY | 화제 발견 |
| SOCIAL | 원발언·화제 발견 |
| UNKNOWN | 게시 근거로 사용하지 않음 |

커뮤니티·SNS의 바이럴은 사실 검증을 대신하지 않는다.

## 14.5 정정·철회

Source가 정정되거나 철회되면 다음을 평가한다.

```text
C0  링크·오탈자
C1  부수 맥락
C2  판단 일부 영향
C3  질문 전제 변화
C4  허위·피해 중대
```

C3 이상은 기존 Issue 종료와 Successor 검토를 기본으로 한다.

## 14.6 건강·안전 정보

의학적 진단·치료를 A/B 인기투표로 단순화하지 않는다.

예:

```text
백신을 맞아야 할까?
```

같은 일반화된 질문은 건강 피해와 오해 가능성이 크다.

정책·경험 질문으로 좁히고 공신력 있는 Source를 요구한다.

## 14.7 Satire와 합성물

풍자·밈은 명확히 표시한다.

- 실제 발언처럼 오인시키지 않음
- 합성 이미지 라벨
- 정치 후보 합성물은 RESTRICTED
- 피해자·미성년자 합성 금지

---

# 15. Spam·조작·우회

## 15.1 Spam 유형

- 동일 질문 반복
- 동일 댓글 복붙
- 외부 링크 도배
- 무관한 상품·서비스 광고
- 자동 생성 대량 콘텐츠
- Keyword Stuffing
- Hashtag·Mention 남용
- 허위 Giveaway

## 15.2 플랫폼 조작

```text
Vote Farm
Reaction Farm
Follow Farm
Report Brigade
Comment Brigade
Multi-account
Bot Automation
Referrer Coordination
Creator Performance Fraud
```

## 15.3 우회 행위

- 정지 계정의 새 계정 생성
- 차단 사용자 재접촉
- 제거된 내용을 캡처·링크로 재게시
- 금지 링크를 단축 URL로 우회
- 자동화 탐지 회피
- 다른 Creator 명의로 대신 게시

## 15.4 조치

```text
Rate Limit
Challenge
Visibility Reduction
Feature Freeze
Count Review
Cluster Invalidation
Account Restriction
Circumvention Suspension
```

## 15.5 정상 바이럴 보호

급격한 유입만으로 조작 판정하지 않는다.

다음 신호를 함께 본다.

- 세션의 다음 Issue 참여
- 신규·기존 계정 혼합
- 외부 문구가 특정 선택을 지시하는지
- Challenge 결과
- 동일 행동 패턴
- 여러 Issue에 반복되는지

## 15.6 유희형 콘텐츠와 Spam

가벼운 질문이 많더라도 같은 Template을 대량 생산하면 중복·품질 정책을 적용한다.

```text
짜장 vs 짬뽕
탕수육 찍먹 vs 부먹
냉면 물 vs 비빔
```

같은 시리즈는 허용될 수 있지만, 동일 의미의 사소한 변형을 무한 생성하지 않는다.

---

# 16. 사칭·사기·악성 링크

## 16.1 사칭

다음을 금지한다.

- 실제 개인·기관·언론·브랜드인 것처럼 Profile 구성
- 공식 인증 표시 위조
- 다른 Creator의 핸들·이미지 복제
- 고객지원·운영자 사칭

## 16.2 풍자·팬 계정

허용 후보 조건:

- Profile에 명확한 비공식 표시
- 공식 로고·Checkmark 혼동 최소화
- 사기·괴롭힘 목적이 아님
- 정치 후보 사칭은 강화 검토

## 16.3 사기

- 금전 송금 유도
- 계정 인증정보 탈취
- 투자 수익 보장
- 허위 경품
- 가짜 고객지원
- 피싱 링크

등은 제거·계정 제한 후보다.

## 16.4 링크 안전

- Redirect Chain 검사
- 악성 URL Reputation
- 단축 URL 확장
- 신규 계정 링크 제한
- 댓글 링크 Rate Limit
- 정치 Campaign 링크 별도 정책

---

# 17. 저작권·출처·권리 요청

## 17.1 원칙

WHICH는 외부 원문을 복제하는 서비스가 아니다.

```text
외부 자료
→ 사실 Claim과 논점 추출
→ WHICH 자체 질문·배경
→ 출처 링크
```

## 17.2 기본 제한

- 기사 전문 복사
- 유료 기사 우회
- 제3자 이미지 무단 사용
- SNS 캡처의 무단 재배포
- 영상 프레임 무단 썸네일
- 워터마크 제거

## 17.3 허용 후보

- 자체 제작 공유 카드
- 자체 제작 이미지
- 명확한 라이선스 자료
- 공식 Embed
- Creator가 권리를 보유한 업로드
- 짧은 인용과 출처 표시가 법적으로 허용되는 범위

## 17.4 권리 요청 Queue

```text
COPYRIGHT_NOTICE
PRIVACY_TAKEDOWN
TRADEMARK_IMPERSONATION
DEFAMATION_CLAIM
SOURCE_CORRECTION
```

정책 신고와 별도 Queue로 운영한다.

## 17.5 Counter Notice·이의 제기

**[법률 확인 필요]** 관할 법률과 사업 구조에 맞춰 권리자의 삭제 요청, 작성자의 반론·복구 절차를 설계한다.

## 17.6 Source 삭제

원 Source가 삭제되었다고 Issue를 즉시 삭제하지는 않는다.

검토:

- 삭제 이유
- 대체 Source
- 질문 전제 유지 여부
- 권리 요청
- 개인정보·피해 문제

---

# 18. Issue 모더레이션 계약

## 18.1 게시 전 Pipeline

```text
Candidate
→ Spam Check
→ Duplicate Check
→ Binary Fit
→ Quality
→ Policy Classification
→ Risk Classification
→ Source Verification
→ Rights Check
→ Human Review 조건
→ Publish Eligibility
```

## 18.2 Risk별 승인

| Risk | 자동 게시 | 인간 검수 | 초기 정책 |
|---|---:|---:|---|
| LOW | 제한 후보 | 표본 QA | 운영자 Seed 중심 |
| MEDIUM | 기본 비허용 | 필요 | 인간 승인 |
| HIGH | 금지 | Senior Review | Fail-Closed |
| RESTRICTED | 금지 | 전용 Reviewer | 법률·운영 승인 |

MVP에서는 LOW도 인간 승인 후 게시하는 방향을 권고한다.

## 18.3 Issue Moderation 상태

```text
NOT_REVIEWED
AUTO_CHECK_PASSED
HUMAN_REVIEW_REQUIRED
APPROVED
CHANGES_REQUESTED
REJECTED
PUBLISHED
UNDER_REVIEW
LIMITED
SUSPENDED
REMOVED
RESTORED
ARCHIVED
```

## 18.4 게시 후 상태 전이

```text
PUBLISHED
→ REPORT_SPIKE / SOURCE_CHANGE / INTEGRITY_ALERT
→ UNDER_REVIEW
→ PUBLISHED
   / LIMITED
   / SUSPENDED
   / REMOVED
```

## 18.5 첫 정상 투표 이후 수정

허용 후보:

- 오탈자
- 깨진 출처 링크
- 의미를 바꾸지 않는 문장부호
- 정정 배너

금지:

- 질문 대상 변경
- A/B 의미 변경
- 선택지 위치 변경
- 핵심 조건 추가·삭제

## 18.6 결과 잠금과 게시 중단 분리

```text
VOTING_PAUSED
RESULTS_LOCKED
RANKING_FROZEN
ISSUE_SUSPENDED
```

을 별도로 사용한다.

예:

- 질문은 읽을 수 있지만 신규 투표만 중단
- 투표는 중단하고 기존 결과도 검토 중 표시
- Issue는 유지하지만 추천에서 제외
- 법적·안전 문제로 전체 접근 중단

## 18.7 수정 요청 UX

Creator에게 다음을 제공한다.

- 문제 문장
- Policy·Quality Reason
- 수정 가능한 범위
- AI 수정 후보
- 제출 기한
- 재검토 상태

중대한 위반을 중립적 표현으로 바꾼다고 자동 허용하지 않는다.

## 18.8 Issue Public Interest

공익성이 있더라도 다음은 유지한다.

- 개인정보 최소화
- 위협·혐오 제한
- 출처·맥락
- 기능·노출 제한
- 피해자 보호

공익성은 무조건 허용 예외가 아니다.

---

# 19. 댓글·답글 모더레이션 계약

## 19.1 댓글의 목적

댓글은 특정 Issue에서 선택의 이유를 설명하는 보조 콘텐츠다.

```text
Issue
→ Vote
→ Result
→ Reason
```

독립적인 무제한 게시판으로 만들지 않는다.

## 19.2 작성 전 검사

```text
Authentication
→ Accepted Vote
→ Account State
→ Thread State
→ Rate Limit
→ Text Policy Check
→ Link Check
→ Submit
```

## 19.3 댓글 처리 상태

```text
DRAFT
SUBMITTING
PENDING_AUTOMOD
PENDING_HUMAN_REVIEW
PUBLISHED
DEPRIORITIZED
COLLAPSED
HIDDEN
REMOVED_BY_AUTHOR
REMOVED_POLICY
LOCKED
RESTORED
FAILED
```

## 19.4 자동 보류 후보

- 직접적 위협
- 고위험 개인정보
- 혐오·비인간화 높은 Confidence
- 반복 Spam
- 악성 URL
- 차단 우회
- 정치 Thread 정책 위반

## 19.5 삭제 대신 축소

명백한 위반이 아니지만 다음에 해당하면 `DEPRIORITIZED` 또는 `COLLAPSED`를 검토한다.

- 질문과 무관한 장문
- 반복적 비꼼
- 의미 없는 도배
- 낮은 품질의 대립 유도
- 동일 문구 반복

작성자에게 정책 Strike를 자동 부여하지 않는다.

## 19.6 A/B Side 중립성

- A 댓글만 더 엄격하게 보지 않음
- B 댓글만 추천에서 배제하지 않음
- 신고량은 Side 규모로 보정 후보
- Reviewer 화면에서 Side 정보가 불필요하면 Blind Review 옵션 검토

## 19.7 댓글 수정

- 짧은 수정 Window 후보
- 수정 이력 보존
- 답글 후 `수정됨` 표시
- 정치·고위험 댓글 수정 시 재검토
- 제거 후 수정으로 복구 우회 금지

## 19.8 댓글 삭제

### 작성자 삭제

- 답글 없음: 제거
- 답글 있음: Placeholder 후보

### 정책 삭제

- 이유 범주 표시
- Reply Thread 유지 여부 정책화
- Quote·Notification·Search에서 제거
- Reputation·Reaction 재계산

## 19.9 Thread Slow Mode

고위험·Burst에서 다음 간격을 적용할 수 있다.

```text
30초
60초
5분
10분
```

투표 속도 제한과 별도다.

## 19.10 Thread Lock

```text
READ_ONLY
NO_NEW_TOP_LEVEL
NO_REPLIES
FULL_LOCK
```

을 구분한다.

---

# 20. Profile·Creator·Social 객체 모더레이션

## 20.1 Profile 대상

- Display Name
- Handle
- Avatar
- Bio
- Link
- Official 표시
- Creator 소개

## 20.2 Profile 위반

- 사칭
- 모욕적·혐오적 닉네임
- 개인정보 노출
- 성적 이미지
- 피싱 링크
- 운영자·공식기관 위조
- 정지 우회

## 20.3 Creator Reputation과 정책 조치

Reputation은 다음과 분리한다.

```text
Policy Violation
Quality Score
Integrity Incident
Popularity
Follower Count
```

Follower가 많다고 위반을 면제하지 않는다.

## 20.4 Creator 제재 단계

```text
WARNING
EDIT_REQUIRED
POSTING_COOLDOWN
CREATOR_PREMODERATION
ISSUE_CREATION_SUSPENDED
ACCOUNT_READ_ONLY
ACCOUNT_SUSPENDED
ACCOUNT_TERMINATED
```

## 20.5 Badge·Milestone 복구

Vote 무효화나 정책 위반으로 Badge를 회수할 수 있다.

Appeal이 승인되면:

- Badge 복구
- Creator Dashboard 복구
- Reputation 재계산
- 추천 Feature 재생성

## 20.6 Follow·Reaction 조작

조작된 Count는 다음에서 제외한다.

- 공개 Count
- Badge
- Reputation
- 추천 Rank
- Creator Milestone

## 20.7 사용자 Block 우선

Block은 Global 정책 판정과 별개로 즉시 개인 UX에 반영한다.

```text
Block
→ 댓글 숨김
→ Follow 종료
→ 알림 중단
→ Creator Issue 제외 후보
```

---
# 21. 신고 시스템과 신고 악용 방지

## 21.1 신고의 목적

신고는 다음 의미다.

> 사용자가 정책 위반 가능성을 운영자에게 전달하는 안전 신호

신고는 다음을 의미하지 않는다.

```text
동의하지 않는 의견에 대한 반대표
콘텐츠 자동 삭제 명령
추천 피드에서의 관심 없음
논쟁 결과에 대한 불만 표시
```

**[확정]** 신고 수만으로 Issue·Comment·Account를 자동 삭제하지 않는다.

## 21.2 신고 대상

```text
ISSUE
COMMENT
REPLY
PROFILE
CREATOR
SOURCE
EXTERNAL_LINK
SHARE_CARD
ACCOUNT
VOTE_OR_REACTION_MANIPULATION
```

투표 결과 자체가 마음에 들지 않는다는 이유는 신고 사유가 아니다.

## 21.3 Issue 신고 Reason Code

| 코드 | 사용자 표시 | 운영 의미 |
|---|---|---|
| `FALSE_PREMISE` | 사실과 다른 전제 | 핵심 배경의 허위·왜곡 가능성 |
| `MISLEADING_CHOICES` | 선택지가 편향됨 | A/B 비대칭·유도성 |
| `HATE_OR_DISCRIMINATION` | 혐오·차별 | 보호 대상 집단 공격 |
| `HARASSMENT` | 특정인 공격 | 모욕·괴롭힘·집단 공격 |
| `PRIVACY` | 개인정보 노출 | Doxxing·사생활 침해 |
| `VIOLENCE_OR_THREAT` | 폭력·위협 | 위협·폭력 조장 |
| `SEXUAL_OR_EXPLOITATIVE` | 성적·착취 콘텐츠 | 비동의 이미지·성적 대상화 |
| `CHILD_SAFETY` | 아동·청소년 안전 | 미성년자 위험 |
| `SPAM_OR_DUPLICATE` | 스팸·중복 | 반복·광고·낚시 |
| `SOURCE_PROBLEM` | 출처 문제 | 출처 누락·불일치·철회 |
| `POLITICAL_ELECTION` | 정치·선거 정책 위반 | 일반 Queue 유입·선거 관련 위험 |
| `COPYRIGHT` | 저작권·권리 침해 | 무단 복제·사용 |
| `OTHER` | 기타 | 자유 설명 필요 |

## 21.4 Comment·Reply 신고 Reason Code

| 코드 | 사용자 표시 |
|---|---|
| `INSULT_OR_HARASSMENT` | 욕설·비방·괴롭힘 |
| `HATE` | 혐오·차별 |
| `THREAT` | 위협·폭력 |
| `PRIVACY` | 개인정보 |
| `SEXUAL` | 성적 콘텐츠 |
| `SPAM` | 도배·광고·링크 스팸 |
| `IMPERSONATION` | 사칭 |
| `ILLEGAL_ACTIVITY` | 불법 행위 조장 |
| `COORDINATED_ABUSE` | 조직적 공격·조작 |
| `OTHER` | 기타 |

## 21.5 긴급 신고

다음은 일반 Queue가 아니라 긴급 Queue로 보낸다.

- 구체적이고 임박한 폭력 위협
- 자살·자해의 즉각적 위험
- 아동 성착취 가능성
- 비동의 성적 이미지
- 주소·전화번호 등 Doxxing
- 실시간 범죄·납치·인질 상황 주장
- 계정 탈취·금융 피싱 확산

긴급 신고 UI는 과도한 자유 서술을 요구하지 않고 다음을 제공한다.

```text
위험 유형
대상
현재 진행 중인지
즉시 확인이 필요한 이유
관련 URL·Comment ID
```

## 21.6 Guest 신고

Guest의 안전 신고를 완전히 막으면 외부 유입 사용자가 위험을 알릴 수 없다.

**[설계 기준]** Guest도 Issue·Comment 신고를 할 수 있게 하되 다음을 적용한다.

- Session·IP 기반 Rate Limit
- 반복 신고 시 Challenge
- 긴급 신고를 제외한 대량 신고 제한
- 로그인 사용자보다 낮은 Reporter Confidence 초기값
- 신고 완료 후 회원가입 강제 금지

Guest 신고가 가능하다는 이유로 Guest 첫 투표 전 추가 마찰을 넣지 않는다.

## 21.7 Reporter Reliability

신고자의 신뢰도는 다음 신호로 내부 계산할 수 있다.

```text
과거 신고 적중률
중대한 위반 신고 적중률
동일 대상 반복 신고
짧은 시간 대량 신고
여러 계정과의 동기화 패턴
Appeal 결과
악의적 허위 신고 이력
```

다음은 Reporter Reliability에 사용하지 않는다.

- A/B 선택 방향
- 정치 성향 추론
- 신고 대상과 의견이 같은지
- Follower 수
- Creator 인기

## 21.8 조직적 신고 공격

다음 패턴은 `REPORT_BRIGADING` 후보로 분류한다.

```text
짧은 시간 신고 급증
신규·휴면 계정 집중
동일 Referrer·Campaign 집중
동일 자유 서술 문구 반복
특정 선택자 댓글만 선별 신고
여러 Issue에서 같은 Creator를 반복 공격
```

대응:

```text
신고 Weight 일시 축소
자동 숨김 금지
대상 Content Safety 재검사
Reporter Cluster 검토
추천 노출은 별도 Integrity 판단
인간 검수 우선순위 조정
```

조직적 신고 의심이 있어도 실제 위반 가능성 검사는 생략하지 않는다.

## 21.9 신고 처리 상태

```text
SUBMITTED
DEDUPLICATED
TRIAGED
IN_REVIEW
ESCALATED
ACTIONED
NO_VIOLATION
DUPLICATE_REPORT
ABUSIVE_REPORT
CLOSED
APPEALED
```

같은 사용자가 같은 Target·Reason을 반복 신고하면 하나의 Case에 묶는다.

## 21.10 신고자 통지

신고자에게는 가능한 범위에서 다음만 알린다.

- 접수됨
- 검토 완료
- 조치함
- 위반을 확인하지 못함
- 추가 정보 필요

다음은 공개하지 않는다.

- 신고 대상자의 개인정보
- 내부 Risk Score
- 탐지 Rule
- 다른 신고자의 정보
- 법 집행기관 요청 상세

## 21.11 신고 대상자 보호

신고 접수만으로 대상자에게 신고자 정보를 노출하지 않는다.

정책 조치가 내려지면 대상자에게는:

- 위반 정책
- 대상 콘텐츠
- 조치
- 지속 기간
- 이의 제기 방법

을 제공한다.

---

# 22. AI 모더레이션 아키텍처

## 22.1 역할 정의

AI Moderation은 다음 네 역할을 맡는다.

```text
분류
우선순위화
수정 제안
인간 검수 지원
```

AI는 다음 역할을 단독 수행하지 않는다.

```text
중대한 계정 영구 정지
정치·선거 Issue 최종 승인
법적 위법성 최종 판단
비동의 성적 이미지 최종 판정
아동 안전 사건 종결
대규모 Vote 무효화
고위험 Appeal 최종 결정
```

## 22.2 Moderation Pipeline

```text
Input Normalization
→ Deterministic Rules
→ Safety Classifiers
→ LLM Policy Evaluation
→ Source·Context Features
→ Confidence·Severity
→ Decision Router
→ Auto Action / Human Queue
```

각 모델은 하나의 거대한 점수보다 정책별 결과를 반환한다.

```text
hate_probability
harassment_probability
threat_probability
privacy_probability
sexual_probability
child_safety_probability
spam_probability
political_probability
leading_question_probability
source_problem_probability
```

## 22.3 게시 전 AI 검사

Issue Candidate에는 다음을 검사한다.

- 질문 명확성
- Binary Fit
- A/B 대칭성
- 유도성 표현
- 허위 전제 가능성
- 출처 필요 여부
- 특정인·집단 피해
- 정치·선거 관련성
- 중복·유사도
- 권리·개인정보 위험

Comment에는 다음을 검사한다.

- 욕설·모욕
- 혐오·비인간화
- 위협
- 개인정보
- 성적 내용
- 스팸·링크
- 동일 문구 반복
- 특정 사용자 집중 공격

## 22.4 게시 후 AI 검사

게시 후에는 단일 콘텐츠 외에 행동 맥락을 함께 본다.

```text
신고 증가율
댓글 Burst
Copy-paste Cluster
새 계정 비율
Side-targeted 공격
Creator 반복 위반
외부 Referrer 집중
모델 예측 변화
Source 정정·철회
```

## 22.5 Structured Output 계약

AI Moderation 결과 예시는 다음과 같다.

```json
{
  "target_type": "ISSUE",
  "target_id": "ISS-1024",
  "policy_version": "moderation_policy_v2",
  "model_version": "moderator_v1.3",
  "risk_level": "HIGH",
  "policy_labels": [
    {
      "code": "MISLEADING_CHOICES",
      "confidence": 0.92,
      "severity": "MEDIUM",
      "evidence_spans": ["정상적인 사람이라면 A"],
      "recommended_action": "EDIT_REQUIRED"
    }
  ],
  "political_review_required": false,
  "human_review_required": true,
  "uncertainties": ["풍자 문맥 여부"],
  "generated_at": "2026-08-17T00:00:00+09:00"
}
```

## 22.6 Evidence Span

가능하면 AI가 판단 근거가 된 문구를 표시한다.

```text
문장 전체
문제 구간
관련 Source Claim
맥락 불확실성
```

단, Evidence Span은 인간 Reviewer를 돕는 보조 정보이며 판정 자체가 아니다.

## 22.7 Confidence와 Severity 분리

```text
Confidence
= 모델이 Label에 얼마나 확신하는가

Severity
= 실제 피해 수준이 얼마나 큰가
```

낮은 Confidence라도 Severity가 매우 높으면 인간 검수로 올린다.

예:

```text
아동 성착취 가능성
Confidence 0.55
Severity CRITICAL
→ 즉시 임시 Hide + Senior Review
```

## 22.8 자동 조치 범위

### Auto Allow 후보

- 명확한 LOW Risk
- 정책 Label 없음
- Source·Spam 검사 통과

### Auto Edit Suggestion 후보

- 경미한 표현 문제
- 문장 명확성
- 선택지 길이 불균형
- 출처 형식 누락

### Auto Limit 후보

- 명백한 반복 Spam
- 알려진 악성 URL
- 동일 Comment 반복
- Rate Limit 위반

### Human Required

- HIGH·RESTRICTED
- 정치·선거
- 혐오·위협의 맥락 판정
- 공인 관련 허위 전제
- 개인정보·Doxxing
- 아동·성적 착취
- 중대한 계정 제재
- 대량 무효화
- Appeal

## 22.9 완전 자동 의사결정 보호

사용자에게 중대한 영향을 주는 자동 조치에는 다음 보호를 둔다.

```text
조치 사유 통지
정책 근거 표시
인간 재검토 요청 경로
오류 복구
모델·정책 Version 보존
```

다음 조치는 기본적으로 인간 확인을 요구한다.

- 영구 계정 정지
- Creator 권한 장기 박탈
- 정치·선거 참여 제한
- 중대한 Reputation 하락
- 대량 콘텐츠 제거
- 대량 Vote 무효화

## 22.10 모델 편향 QA

평가 Slice 예:

- 한국어 신조어·은어
- 세대별 표현
- 지역어·사투리
- 정치적 중립 문장
- 인용·반박 문맥
- 풍자·유머
- 집단명과 개인명
- 피해자 증언
- 소수 의견 댓글
- A/B 각 Side

A와 B 중 어느 Side를 선택했는지가 위반 탐지 결과에 영향을 주지 않는지 별도 검증한다.

## 22.11 Drift 감시

다음 상황에서 모델 성능이 변할 수 있다.

```text
신조어 확산
선거 기간 표현 변화
대규모 밈
우회 철자
새로운 피싱 도메인
특정 커뮤니티 공격 문구
새 Model 배포
Policy 변경
```

Drift Signal:

- 인간 Overturn 증가
- Appeal 인용 증가
- 특정 정책 False Positive 증가
- 특정 카테고리 Queue 폭증
- Reviewer 불일치 증가
- 모델 Confidence 분포 변화

## 22.12 모델 변경 관리

```text
OFFLINE_EVALUATION
→ SHADOW
→ LIMITED_CANARY
→ REVIEWER_ASSIST
→ LIMITED_AUTO_ACTION
→ PRODUCTION
```

HIGH·RESTRICTED의 최종 판정은 모델 배포 단계와 관계없이 인간 우선 원칙을 유지한다.

## 22.13 외부 Moderation Provider

외부 Provider 사용 시 확인할 항목:

- 데이터 저장 지역
- 학습 재사용 여부
- 보존 기간
- 하위 처리자
- 한국어 성능
- 삭제 요청 대응
- 민감정보 처리
- 장애 시 Fallback
- Audit 가능성
- 정책 Version 고정 가능성

정치 선택·민감정보를 불필요하게 외부 Provider에 전송하지 않는다.

---

# 23. 인간 검수 운영

## 23.1 Queue 구조

```text
CRITICAL_SAFETY
CHILD_SAFETY
PRIVACY_DOXXING
SEXUAL_EXPLOITATION
VIOLENCE_THREAT
POLITICAL_ELECTION
HIGH_RISK_ISSUE
SOURCE_FACT_CHECK
COMMENT_ABUSE
SPAM_MANIPULATION
COPYRIGHT_RIGHTS
APPEAL
QUALITY_EDIT
```

## 23.2 Queue Priority

개념적 Priority:

```text
Severity
× Immediacy
× Reach
× Vulnerability
× Confidence
× Integrity Context
× Legal Deadline
```

단순 신고 수는 Priority의 일부일 뿐이다.

## 23.3 Reviewer 화면

Reviewer에게 필요한 정보:

- Target 원문과 Revision
- 질문·A/B·배경·출처
- 해당 Issue Risk·Category
- AI Label과 Evidence
- 신고 Reason·Cluster
- Creator·Account 위반 이력
- 관련 댓글 Thread
- Vote·Reaction 이상 신호
- 외부 Referrer 요약
- 이전 유사 Case
- 적용 가능한 Policy Version
- 가능한 Action

정치·고위험 검수에서는 A/B 실시간 결과를 기본적으로 가리지 않는 것이 필요한 경우도 있지만, Reviewer가 다수 의견에 끌리는 편향을 줄이기 위해 **Policy 판정 단계에서는 결과 비율을 숨기는 Blind Review Mode**를 제공한다.

## 23.4 Blind Review

Blind Review 후보:

- 질문 편향
- Comment 혐오·괴롭힘
- 정치 중립성
- Creator 인기와 무관한 정책 판정
- A/B Side 공정성

숨길 수 있는 정보:

- Creator Follower
- 누적 Vote
- A/B 비율
- 신고 수 원문
- Trending Rank

필요한 경우 판정 후 운영 영향 평가 단계에서 다시 공개한다.

## 23.5 2단계 검토

다음은 Senior Reviewer 또는 2인 승인 후보다.

- 정치·선거 게시 승인
- 계정 영구 정지
- 대규모 Vote 무효화
- 결과 잠금 장기화
- 공인 관련 중대한 허위 주장
- 아동·성적 착취
- 법 집행기관 관련 조치
- 주요 Creator 제재
- 높은 노출의 Issue 제거

## 23.6 이해상충

Reviewer는 다음 Case에서 스스로 회피할 수 있어야 한다.

- 개인적 관계가 있는 사용자
- 직접 참여한 Issue
- 운영자가 만든 Issue
- 법적 분쟁 당사자
- 이해관계가 있는 정치·사회 사건

회피 이유는 Audit에 남기되 사용자에게 Reviewer 신원을 공개하지 않는다.

## 23.7 Reviewer Action

```text
APPROVE
NO_VIOLATION
EDIT_REQUIRED
LABEL
DEPRIORITIZE
COLLAPSE
HIDE_PENDING_REVIEW
REMOVE_CONTENT
LOCK_THREAD
LIMIT_ISSUE
SUSPEND_ISSUE
FREEZE_RANKING
LOCK_RESULT
RESTRICT_FEATURE
WARN_ACCOUNT
SUSPEND_ACCOUNT
TERMINATE_ACCOUNT
ESCALATE_LEGAL
ESCALATE_SAFETY
RESTORE
```

## 23.8 Reviewer Notes

내부 Note에는 다음을 포함한다.

```text
적용 Policy
핵심 Evidence
맥락
Action 이유
기간
재검토 조건
사용자 통지 문구
Appeal 가능 여부
```

개인적인 평가나 정치적 의견을 기록하지 않는다.

## 23.9 Reviewer 교육

필수 교육 후보:

- WHICH 질문·A/B 구조
- 혐오·괴롭힘 구분
- 공인과 사인 구분
- 개인정보·Doxxing
- 아동·성적 안전
- 정치·선거 Fail-Closed
- Source 검증
- 신고 공격
- Vote Integrity
- Appeal·복구
- 개인정보 최소 접근

## 23.10 Reviewer Wellness

고위험 콘텐츠 노출을 최소화하기 위해:

- 썸네일 Blur
- 경고 후 열기
- 자동 재생 금지
- 교대 근무
- 노출 시간 제한
- 심리 지원
- 민감 Queue 선택적 배정

을 검토한다.

---

# 24. 판정 일관성·품질 보증

## 24.1 Policy Gold Set

정책별 대표 Case를 구축한다.

```text
CLEAR_ALLOW
CLEAR_REMOVE
BORDERLINE
CONTEXT_DEPENDENT
SATIRE
QUOTE_TO_CONDEMN
PUBLIC_INTEREST
POLITICAL_NEUTRALITY
SIDE_BALANCE
```

Gold Set은 정책 변경 시 재평가한다.

## 24.2 Reviewer Calibration

정기적으로 같은 Case를 여러 Reviewer가 독립 판정한다.

측정 후보:

- Agreement Rate
- Cohen's Kappa 또는 유사 지표
- Severity별 일치율
- 정책별 Overturn
- A/B Side별 차이
- Reviewer별 편향

## 24.3 QA Sampling

다음 표본을 재검토한다.

- Auto Allow 일부
- Auto Limit 일부
- Human Remove 일부
- No Violation 일부
- Appeal 미제기 Case 일부
- 정치·고위험 전수 또는 높은 비율
- 신규 모델 판정
- 특정 Side 댓글

## 24.4 오류 유형

```text
FALSE_POSITIVE
FALSE_NEGATIVE
WRONG_POLICY
WRONG_SEVERITY
WRONG_ACTION
INSUFFICIENT_REASON
MISSING_CONTEXT
INCONSISTENT_REVIEW
DELAYED_ACTION
RESTORATION_FAILURE
```

## 24.5 Policy Gap

기존 정책으로 일관되게 판정할 수 없는 Case는 `POLICY_GAP`으로 표시한다.

```text
Case 보존
임시 위험 완화
Policy Owner 검토
새 Rule 제정
Reviewer 교육
과거 유사 Case 재검토
```

## 24.6 A/B Side Fairness Audit

동일한 공격 강도와 표현을 A와 B Side에 바꿔 적용한 Pair Test를 수행한다.

예:

```text
[A 선택자는 무식하다]
[B 선택자는 무식하다]
```

정책 결과가 동일해야 한다.

정치·젠더·세대·지역처럼 갈등 가능성이 높은 주제에서 특히 중요하다.

## 24.7 Source·언어 QA

다음 오류를 별도 측정한다.

- 한국어 존댓말·반어 오인
- 인용문을 작성자 의견으로 오인
- 기사 제목과 본문 불일치
- 번역 과정 의미 변경
- 날짜·지역 누락
- 풍자·밈 오인

---

# 25. 제재 Action Ladder

## 25.1 기본 철학

**[확정]** 콘텐츠·기능·계정 제재를 분리하고, 가능한 경우 가장 작은 유효 조치를 사용한다.

```text
정보 제공
→ 노출 축소
→ 기능 제한
→ 콘텐츠 제거
→ 계정 제한
→ 계정 정지
```

## 25.2 Content Action

```text
ALLOW
LABEL
EDIT_REQUIRED
DEPRIORITIZE
COLLAPSE
HIDE_PENDING_REVIEW
REMOVE_POLICY
REMOVE_LEGAL
ARCHIVE
```

## 25.3 Issue Action

```text
PUBLISH
LIMIT_RECOMMENDATION
EXCLUDE_FROM_POPULAR
EXCLUDE_FROM_CONTROVERSY
FREEZE_RANKING
DISABLE_NEW_VOTES
LOCK_RESULT
LOCK_COMMENTS
SUSPEND
REMOVE
CREATE_SUCCESSOR
```

## 25.4 Feature Action

```text
COMMENT_COOLDOWN
COMMENT_PREMODERATION
COMMENT_DISABLED
ISSUE_CREATION_COOLDOWN
ISSUE_CREATION_PREMODERATION
ISSUE_CREATION_DISABLED
FOLLOW_DISABLED
REACTION_DISABLED
SHARE_DISABLED
READ_ONLY
```

## 25.5 Account Action

```text
NOTICE
WARNING
TEMPORARY_RESTRICTION
READ_ONLY
TEMPORARY_SUSPENSION
INDEFINITE_SUSPENSION
TERMINATION
```

## 25.6 Inform·Reduce·Remove

운영 관점에서 세 층을 구분한다.

### Inform

- 출처 표시
- 정정 Label
- 비대표성 고지
- 민감 콘텐츠 경고
- AI·합성물 표시

### Reduce

- 추천 제외
- 검색 순위 축소
- 댓글 접기
- 공유 기능 제한
- 급상승·논쟁 제외

### Remove

- 콘텐츠 비공개
- Thread 제거
- Issue 중단
- 계정 정지

## 25.7 반복 위반

반복 위반 판단은 단순 횟수보다 다음을 본다.

```text
Severity
고의성
피해 범위
정책 회피
수정 노력
시간 간격
Appeal 결과
동일 위반 반복
```

## 25.8 단일 중대 위반

다음은 누적 경고 없이 강한 조치가 가능하다.

- 구체적 폭력 위협
- 아동 성착취
- 비동의 성적 이미지
- 대규모 Doxxing
- 금융 사기·피싱
- 계정 탈취
- 조직적 선거 조작
- 정지 우회 공격

## 25.9 Strike System 초기안

정책 이해를 돕기 위한 공개 Strike가 필요한지 `[미정]`이다.

내부적으로는 다음 수준을 유지한다.

```text
policy_event
severity
action
expires_at
appeal_status
```

공개 Strike 숫자가 사용자 간 공격·낙인으로 사용되지 않도록 외부 Profile에는 표시하지 않는다.

## 25.10 제재 기간

초기 후보:

| 조치 | 기간 후보 |
|---|---:|
| Comment Cooldown | 10분~24시간 |
| Comment Premoderation | 1~30일 |
| Issue Creation Cooldown | 1~7일 |
| Issue Creation Suspension | 7~90일 |
| Read-only | 1~30일 |
| Account Suspension | 1~90일 또는 무기한 |

정확한 기간은 Policy Severity와 운영 데이터로 확정한다.

---

# 26. 조치 사유 통지

## 26.1 통지 원칙

사용자가 조치 이유를 이해할 수 있어야 한다.

통지에는 가능한 범위에서 다음을 포함한다.

```text
조치 대상
위반 정책
문제가 된 내용
적용 조치
시작·종료 시점
복구 조건
이의 제기 경로
```

## 26.2 Statement of Reasons

내부 구조:

```text
notice_id
subject_id
target_type
target_id
policy_code
action_code
action_scope
duration
human_or_automated
key_reason
appeal_eligible
issued_at
policy_version
```

## 26.3 자동·인간 판정 표시

가능한 범위에서 다음을 구분한다.

- 자동 시스템으로 제한됨
- 자동 시스템이 탐지하고 인간이 확인함
- 인간 Reviewer가 결정함
- 법적 요청에 따라 제한됨

내부 보안 Rule이나 악용 가능한 Threshold는 공개하지 않는다.

## 26.4 Issue 수정 요청 예시

```text
이 질문은 현재 게시할 수 없습니다.

이유
- 선택지 A와 B의 표현 강도가 크게 다릅니다.
- 질문에 특정 답을 유도하는 표현이 포함돼 있습니다.

수정 방법
- 두 선택지의 길이와 조건을 맞춰 주세요.
- "상식적인 사람이라면" 표현을 제거해 주세요.

[수정하기]
[결정에 이의 제기]
```

## 26.5 Comment 제거 예시

```text
댓글이 숨김 처리되었습니다.

적용 정책
특정 사용자를 향한 반복적인 모욕·괴롭힘

조치
댓글 비공개
댓글 작성 24시간 제한

[정책 보기]
[이의 제기]
```

## 26.6 법적 요청 통지

법률상 허용되고 수사·안전에 지장을 주지 않는 범위에서:

- 법적 요청에 따른 제한임
- 적용 지역
- 대상 콘텐츠
- 가능한 이의 절차

를 안내한다.

---

# 27. 이의 제기와 복구

## 27.1 Appeal 대상

```text
Issue Reject·Remove
Comment Remove
Profile 제한
Creator 기능 제한
Account Suspension
Political Eligibility 제한
Vote Invalidation 통지 대상
Copyright 조치
Automated Significant Decision
```

경미한 단기 Rate Limit은 별도 자동 재검토 경로를 제공할 수 있다.

## 27.2 Appeal 원칙

- 원 판정자와 다른 Reviewer 우선
- Appeal 제출에 새 콘텐츠 생성 요구 금지
- 간결한 이유 선택 + 선택적 설명
- 관련 Evidence 첨부 가능
- 제출 상태 추적
- 결과와 근거 통지
- 승인 시 완전한 복구

## 27.3 Appeal 상태

```text
ELIGIBLE
SUBMITTED
IN_REVIEW
NEEDS_INFORMATION
UPHELD
PARTIALLY_OVERTURNED
OVERTURNED
DISMISSED_DUPLICATE
ABUSIVE_APPEAL
CLOSED
```

## 27.4 기간 초기안

| 항목 | 초기 후보 |
|---|---:|
| 일반 Content Appeal 제출 | 조치 후 30일 |
| 계정 정지 Appeal | 30~90일 |
| 저작권·법적 조치 | 별도 법적 절차 |
| 긴급 안전 조치 | 우선 검토 |

실제 기간은 법률·운영 검토 후 확정한다.

## 27.5 Appeal 결과

```text
UPHOLD
RESTORE
REDUCE_ACTION
CHANGE_POLICY_CODE
REQUEST_EDIT
ESCALATE_LEGAL
```

## 27.6 완전 복구 계약

Appeal이 승인되면 콘텐츠만 다시 보이는 것으로 끝나지 않는다.

복구 대상:

- 콘텐츠 Visibility
- 댓글 Thread
- Creator Reputation
- Badge·Milestone
- Follower·Reaction 정상 Count
- 추천 Eligibility
- ML Training Label
- Search Index
- Notification 상태
- Account Strike

## 27.7 Vote 복구

무효화된 Vote가 정상으로 판정되면:

```text
RESTORED Action 기록
Aggregate 재계산
A/B 비율 재계산
Controversy·Popularity 재계산
Creator Milestone 재계산
학습 Dataset 수정
사용자 기록 복구
```

## 27.8 악의적 Appeal

반복적인 무관 제출·위협·Spam은 Appeal 기능을 제한할 수 있다.

그러나 중대한 조치에 대한 최소 한 번의 인간 재검토 권한은 가능한 범위에서 유지한다.

## 27.9 Appeal 품질 지표

- Appeal Rate
- Overturn Rate
- 부분 인용률
- Policy별 Overturn
- Reviewer별 Overturn
- 처리 시간
- 복구 누락률
- 재Appeal률

높은 Overturn은 사용자 악용보다 초기 판정 품질 문제일 수 있으므로 원인을 분석한다.

---
# 28. 정치·선거 Safe Line

## 28.1 최상위 원칙

**[확정]** 정치·선거 콘텐츠는 일반 카테고리의 고위험 버전이 아니라 별도 Governance Domain이다.

이유:

- 조직적 투표·좌표찍기 위험
- 후보·정당 지지 유도 위험
- 결과가 대표 여론으로 오해될 위험
- 선거법상 여론조사·모의투표·인기도 조사 규율 가능성
- 정치적 견해라는 민감정보 처리 위험
- 운영자의 중립성 논란
- 추천 시스템을 통한 증폭 위험

## 28.2 범위 분류

### `PUBLIC_POLICY`

특정 후보·정당 지지와 직접 연결되지 않은 제도·정책 판단.

예:

```text
도심 혼잡 통행료를 도입해야 할까?
```

상황에 따라 `MEDIUM`, `HIGH`, `RESTRICTED`가 될 수 있다.

### `POLITICAL`

정부·정당·정치인·의회·외교·안보·정책 성과와 직접 연결되는 질문.

예:

```text
현 정부의 ○○ 정책을 계속 추진해야 할까?
```

기본 `RESTRICTED`.

### `ELECTION`

다음을 포함한다.

- 후보·정당 지지
- 당선 예측
- 모의투표
- 인기도 조사
- 공약 비교를 통한 투표 유도 가능 질문
- 선거 결과·투표율 관련 질문
- 특정 선거에 직접 영향을 줄 수 있는 콘텐츠

기본 `RESTRICTED_ELECTION`.

## 28.3 MVP 기본 정책

**[초기 권고안]** MVP에서는 다음을 비활성화한다.

```text
후보·정당 지지 A/B 투표
당선 예측 투표
선거 모의투표
정치·선거 댓글
정치 Issue 사용자 생성
정치 Choice 기반 개인화
정치 급상승·논쟁 피드
```

정치·선거 기능은 제품 성장을 위해 억지로 포함하지 않는다.

## 28.4 선거법 Legal Gate

**[법률 확인 필요]** 대한민국 공직선거법상 선거에 관한 여론조사는 명칭과 형식만으로 판단되지 않을 수 있으며, 모의투표·인기도 조사 등도 규율 범위에 포함될 가능성이 있다.

따라서 다음 문구만으로 안전하다고 가정하지 않는다.

```text
이 결과는 대표 여론조사가 아닙니다.
```

출시 전 확인 항목:

- 어떤 질문이 선거 여론조사에 해당하는지
- 조사·게시·공표 주체의 의무
- 신고·등록 필요 여부
- 질문 문구와 편향 제한
- 조사 결과 공표 금지 기간
- 표본·방법·응답률 등 표시 의무
- 원자료·기록 보존 의무
- 해외 사용자·외부 SNS 공유 영향
- 선거관리위원회 문의 필요성

법적 요건을 충족할 수 없으면 해당 Surface는 `FAIL_CLOSED`한다.

## 28.5 Election Mode

선거 기간 또는 선거 관련 위험이 높아진 기간에는 별도 운영 모드를 사용한다.

```text
NORMAL
PRE_ELECTION_RESTRICTED
ELECTION_MODE
BLACKOUT_OR_FREEZE
POST_ELECTION_REVIEW
```

`Election Mode` 전환은 다음으로 Trigger될 수 있다.

- 법정 선거 일정
- 재·보궐선거
- 후보 등록
- 선거 관련 법률 자문
- 선거관리기관 공지
- 대규모 조직적 유입

## 28.6 Election Mode 기본 동작

```text
정치 사용자 생성 중단
정치 편집 Issue 신규 게시 중단 후보
정치 추천 자동 증폭 중단
정치 결과 공유 제한
정치 댓글 잠금 또는 Slow Mode
Political Queue 2인 승인
법적 공표 제한 기간 결과 잠금
외부 Link Burst 강화 감시
```

정확한 운영 기간은 법률 검토 후 설정한다.

## 28.7 정치 Issue 게시 조건

향후 정치 Issue를 활성화하려면 최소한 다음을 요구한다.

```text
Editorial Operator 작성
Political Classification
복수 Source 검증
Neutrality Review
Legal Review 필요성 판정
Senior Reviewer 승인
Integrity Policy 지정
Eligibility 지정
Result Disclosure 문구
Expiry·Re-review 지정
Audit Snapshot
```

## 28.8 질문 중립성

금지 예:

```text
무능한 ○○ 후보를 계속 지지해야 할까?
국민을 위한 ○○ 정책에 반대하십니까?
상식적으로 ○○당보다 △△당이 낫지 않은가?
```

허용 여부 검토 예:

```text
○○ 후보가 제안한 △△ 정책을 시행하는 데 동의하십니까?
A. 동의한다
B. 동의하지 않는다
```

허용 여부는 문장 중립성만이 아니라 선거법상 조사·공표 요건까지 함께 판단한다.

## 28.9 정치 참여 Eligibility

활성화 시 초기안:

```text
Guest                불가
Member               불가 또는 읽기만
Verified Member      정책 충족 시 투표 후보
```

추가 조건 후보:

- 최근 강한 재인증
- Account Age 최소 기준
- 하나의 Verified Uniqueness Handle
- 정치 기능 별도 동의
- 지역·법적 Eligibility 확인
- 강화 Rate Limit

Verification은 한 사람 한 계정을 완벽히 증명한다는 주장을 하지 않는다.

## 28.10 정치 결과 표시

반드시 표시할 내용 후보:

```text
WHICH 참여자 결과
대표 표본 아님
자발적 참여
집계 기준
정상 집계 수
기준 시점
결과 검토 상태
```

표시하지 않거나 제한할 내용:

- 지역별 세밀한 정치 성향 지도
- 특정 집단의 후보 지지 추정
- 실시간 Raw Vote Stream
- Verified 사용자 명단
- 개인의 정치 선택 이력
- 공격자가 Integrity 방식을 역추론할 수 있는 세부 수치

## 28.11 정치 추천 격리

```text
General For You          제외
General Trending         제외
General Controversy      제외
Guest Cold Start         제외
Playful Feed             제외
General Exploration      제외
```

활성화된 정치 Surface에서도:

- Engagement Boost 상한
- 외부 Burst 시 Ranking Freeze
- Integrity Penalty 우선
- Choice Direction Feature 금지
- General Model Training 제외
- 사용자 Follow·Opinion Graph 금지

을 적용한다.

## 28.12 정치 댓글

**[초기 권고안]** 출시하지 않는다.

향후 활성화 전제:

- Verified 작성자
- Accepted Vote 또는 별도 자격
- Slow Mode
- Premoderation 후보
- Side-aware 공정성 QA
- Reaction Count 증폭 제한
- External Burst 감시
- Human Moderator Coverage
- Thread Lock Playbook

## 28.13 정치 민감정보

정치 A/B 선택은 다음 용도로 사용하지 않는다.

```text
정치 성향 Profile
광고 Targeting
Creator 추천
친구 추천
외부 데이터 판매
유사 정치 입장 그룹
Follower 추천
```

접근 권한을 최소화하고 보존 기간도 별도로 검토한다.

## 28.14 정치 Incident

정치 Issue에서 다음 발생 시 자동 완화한다.

```text
Referrer Concentration 급증
신규 계정 Burst
Vote-only Session 집중
특정 Choice 지시 문구
다중 계정·자동화 신호
Report Brigading
법적 공표 제한 가능성
Source 정정
```

대응:

```text
추천 Freeze
신규 Vote Challenge
결과 Lock
공유 제한
댓글 Lock
Senior Review
Legal Escalation
필요 시 Issue 중단
```

---

# 29. 취약 사용자·피해자·미성년자 보호

## 29.1 Vulnerability Signal

운영자가 확인할 취약성 예:

- 미성년자
- 범죄·폭력 피해자
- 성적 착취 피해자
- Doxxing 대상
- 자살·자해 위험 사용자
- 장애·질병과 관련된 표적
- 대규모 온라인 공격 대상

이 정보는 최소 필요 범위로만 사용한다.

## 29.2 피해자 중심 조치

가능한 조치:

- 즉시 Hide
- 개인 식별 정보 Masking
- 검색·추천 제외
- 공유 카드 무효화
- Cache Purge
- 관련 댓글 Thread Lock
- 반복 업로드 Hash 차단 후보
- 피해자 연락 창구
- 복구 상태 안내

## 29.3 공익과 피해 균형

공익적 사건이라는 이유로 피해자 식별 정보를 무제한 허용하지 않는다.

질문은 가능한 경우 개인보다 다음을 대상으로 전환한다.

```text
정책
제도
기관 대응
행위 기준
공공 안전
```

## 29.4 미성년자 참여

**[미정]** MVP의 최소 가입 연령과 만 14세 미만 처리 방식을 법률·제품 관점에서 확정해야 한다.

최소 요구:

- 연령 정책 고지
- 필요한 경우 법정대리인 동의
- 미성년자 Profile 최소화
- 학교·주소·연락처 수집 금지
- 성인 대상 민감 콘텐츠 제한
- Creator 기능 제한 후보
- 정치·RESTRICTED 참여 제한

## 29.5 학교·청소년 질문

다음은 허용 가능하다.

```text
학교 휴대전화 사용 규칙
숙제에서 AI 사용
교복·급식·수업 방식
```

다음은 금지 또는 HIGH Review다.

- 특정 학생 평가
- 학교폭력 피해자 식별
- 미성년자 연애·성적 대상화
- 교사·학생 신상 공개
- 특정 학교 집단 조롱

## 29.6 피해자 선택 비공개

피해 경험과 연결될 수 있는 Issue에서는 A/B Choice 공개 기본값을 더 제한한다.

예:

```text
직장 내 괴롭힘 경험
성폭력 신고 경험
정신건강 치료 경험
범죄 피해 경험
```

이러한 질문 자체가 WHICH의 A/B 형식에 적합한지 Binary Fit·피해 위험부터 재검토한다.

---

# 30. 개인정보·자동화된 결정 Governance

## 30.1 데이터 최소화

Moderation에 필요한 정보만 수집한다.

```text
Content
Context
Policy History
Integrity Summary
Report Evidence
Required Account State
```

Reviewer에게 원본 IP·정밀 Device Fingerprint·불필요한 정치 Choice를 기본 노출하지 않는다.

## 30.2 민감정보

특히 높은 보호가 필요한 후보:

- 정치적 견해
- 건강·장애
- 성생활·성적 지향
- 종교
- 범죄 피해
- 생체·신원확인 정보
- 아동 관련 정보

이러한 정보는 일반 추천·광고·Creator Reputation에 사용하지 않는다.

## 30.3 접근 통제

```text
Moderator
Senior Moderator
Privacy Officer
Security Analyst
Legal Reviewer
ML Operator
```

각 역할은 필요한 데이터만 본다.

예:

```text
Comment Moderator
→ 댓글·문맥·정책 이력
→ 원본 IP 불필요

Integrity Analyst
→ Network·Session 요약
→ 댓글의 정치 Choice 불필요
```

## 30.4 자동 결정 고지와 재검토

중대한 자동 결정이 발생하면 가능한 범위에서:

- 자동 시스템 사용 여부
- 주요 판단 범주
- 조치 결과
- 인간 재검토 경로

를 제공한다.

다음은 내부적으로 보존한다.

```text
input_snapshot
feature_version
model_version
policy_version
automated_action
human_override
```

## 30.5 설명 가능성

사용자 설명은 이해 가능한 정책 수준으로 제공한다.

허용 예:

```text
동일한 광고성 댓글을 짧은 시간에 반복 게시해
Spam 정책에 따라 댓글 작성이 제한되었습니다.
```

공개하지 않는 예:

```text
Risk Score가 78.43이고 Rule 31-7을 통과하지 못함
```

## 30.6 데이터 주체 요청

출시 전 다음 요청 처리 절차가 필요하다.

- 열람
- 정정
- 삭제
- 처리 정지
- 자동 결정 관련 설명·재검토
- 계정 삭제

Moderation Audit·법적 보존 자료는 법적 근거와 필요 범위에 따라 별도 처리한다.

## 30.7 계정 삭제와 공공 기록

계정 삭제 시 다음을 구분한다.

```text
Profile 식별 정보
개인 Vote 기록
댓글
작성 Issue
Moderation Audit
법적 보존 Evidence
Aggregate 통계
```

삭제된 사용자의 댓글·Issue를 익명화할지 삭제할지는 콘텐츠 성격·타인의 답글·법적 의무를 고려해 별도 정책으로 확정한다.

## 30.8 Reviewer Privacy

사용자에게 개별 Reviewer의 실명·개인 계정을 공개하지 않는다.

내부에서는 모든 Action을 Reviewer ID와 연결해 Audit 가능하게 한다.

---

# 31. 법적 요청·권리 요청 운영

## 31.1 요청 유형

```text
LAW_ENFORCEMENT
COURT_ORDER
GOVERNMENT_REQUEST
COPYRIGHT
PRIVACY_RIGHT
DEFAMATION_NOTICE
ELECTION_AUTHORITY
CONSUMER_COMPLAINT
SECURITY_INCIDENT
```

## 31.2 접수 원칙

- 요청자 신원 확인
- 법적 근거 확인
- 관할 확인
- 대상 범위 최소화
- 긴급성 확인
- 법률 담당 Escalation
- 처리 기록

일반 신고 Queue와 섞지 않는다.

## 31.3 데이터 제공 최소화

법적으로 유효한 요청이라도 필요한 범위만 제공한다.

```text
대상 계정
대상 기간
대상 데이터 유형
요청 목적
법적 근거
```

범위를 벗어나는 대량 요청은 Legal Review한다.

## 31.4 사용자 통지

법률상 금지되지 않고 안전·수사에 지장을 주지 않는 범위에서 사용자에게 통지하는 정책을 검토한다.

## 31.5 Geo Restriction

법적 요구가 특정 지역에만 적용될 경우:

```text
GLOBAL_REMOVE
```

대신:

```text
REGION_LIMIT
```

이 가능한지 검토한다.

다만 안전상 전 세계 제거가 필요한 콘텐츠는 예외다.

## 31.6 보존 요청

법적 보존 요청은 일반 Retention 만료보다 우선할 수 있다.

```text
legal_hold_id
scope
start_at
review_at
release_at
approver
```

법적 보존이 종료되면 일반 보존 정책으로 돌아간다.

## 31.7 명예훼손·사실 분쟁

운영자가 법원의 역할을 대신하지 않는다.

다음 요소를 검토한다.

- 사실 주장인지 의견인지
- 공인·사인 여부
- 출처
- 피해 가능성
- 정정 요청
- 긴급 임시 제한 필요성
- 법적 문서

고위험 Case는 Legal Queue로 보낸다.

---

# 32. Incident Response

## 32.1 Incident 정의

정상 Case 처리 범위를 넘어 다음 중 하나를 충족하면 Incident로 본다.

- 피해가 빠르게 확산
- 다수 사용자·Issue 영향
- 정치·선거 조작
- 개인정보 유출
- 자동 모델 오작동
- 대량 잘못된 삭제
- 아동·성적 착취
- 법적 긴급 요청
- 추천 시스템이 유해 콘텐츠를 증폭
- Vote 결과 무결성 붕괴

## 32.2 Severity

| 등급 | 예 |
|---|---|
| `SEV-1` | 생명·아동 안전, 대규모 개인정보 유출, 선거 조작, 광범위 시스템 오작동 |
| `SEV-2` | 고노출 Issue 피해, 다수 계정 공격, 대량 오판 |
| `SEV-3` | 제한된 Queue·Feature 영향, 중간 규모 Spam 공격 |
| `SEV-4` | 일반 운영 이슈, 낮은 영향 |

## 32.3 Incident Lifecycle

```text
DETECT
→ DECLARE
→ CONTAIN
→ PRESERVE
→ ASSESS
→ CORRECT
→ NOTIFY
→ RECOVER
→ POSTMORTEM
```

## 32.4 Containment Action

- Issue·Thread 잠금
- Ranking Freeze
- 결과 Lock
- 신규 Vote·Comment Challenge
- 특정 Feature 비활성
- Model Rollback
- Rule 강화
- 악성 Domain 차단
- 법률·보안 Escalation

## 32.5 Evidence Preservation

Incident 시작 시 다음 Snapshot을 보존한다.

```text
Content Revision
Source Snapshot
Vote·Comment Aggregate
Relevant Raw Events
Model·Policy Version
Moderator Action
External Referrer Summary
System Log
```

보존은 개인정보 최소화와 Legal Hold 정책을 따른다.

## 32.6 정치 좌표찍기 Playbook

```text
1. Anomaly 확인
2. General Ranking Freeze
3. 신규 Vote Challenge 강화
4. 결과 Lock 후보
5. 외부 Referrer·Campaign 분석
6. 정상 Viral과 비교
7. Senior Integrity Review
8. 이상 Vote 분리
9. 결과 재계산
10. 필요 시 투명성 Note
```

## 32.7 잘못된 대량 삭제 Playbook

```text
Auto Action 중단
Model Rollback
Affected Target 식별
Content Restore
Strike·Reputation 복구
Notification 발송
Training Data 수정
Root Cause 분석
```

## 32.8 Source 오보 Playbook

```text
Source 철회 탐지
관련 Issue 검색
신규 Vote 제한
배경 정정 또는 Issue 중단
Successor 필요성 판단
사용자 통지
Aggregate·공유 카드 처리
```

## 32.9 Doxxing Playbook

```text
즉시 Hide
Search·Recommendation 제외
Cache·Preview Purge
재업로드 탐지
피해자 연락 채널
Account·Cluster 검토
필요 시 법률·안전 Escalation
```

## 32.10 Postmortem

포함 항목:

- 무엇이 발생했는가
- 언제 탐지했는가
- 영향 범위
- 원인
- 왜 기존 Guardrail이 실패했는가
- 사용자 피해
- 복구
- 재발 방지
- 책임자·기한

개인 비난보다 시스템 개선에 초점을 둔다.

---

# 33. 역할·권한·직무 분리

## 33.1 운영 역할

```text
EDITORIAL_OPERATOR
MODERATOR
SENIOR_MODERATOR
INTEGRITY_ANALYST
SAFETY_LEAD
POLICY_OWNER
LEGAL_REVIEWER
PRIVACY_OFFICER
SECURITY_OPERATOR
ML_OPERATOR
SUPPORT_AGENT
AUDITOR
ADMIN
```

## 33.2 최소 권한

각 역할은 업무에 필요한 최소 권한만 가진다.

| 역할 | 주요 권한 |
|---|---|
| Editorial Operator | Candidate 작성·수정, 게시 요청 |
| Moderator | 일반 Content 판정 |
| Senior Moderator | 고위험·Appeal·강한 제재 |
| Integrity Analyst | Vote·Reaction 이상 분석 |
| Policy Owner | 정책 제정·Reason Code 관리 |
| Legal Reviewer | 법적 요청·선거·명예훼손 검토 |
| Privacy Officer | 민감정보·권리 요청 |
| ML Operator | 모델 배포·Rollback, 콘텐츠 판정 직접 변경 불가 |
| Auditor | 읽기 전용 Audit |

## 33.3 직무 분리

다음 조합은 가능하면 한 사람이 독점하지 않는다.

```text
정치 Issue 작성 + 최종 승인
모델 배포 + QA 승인
대량 Vote 무효화 + 최종 집계 승인
영구 정지 + Appeal 판정
법적 요청 접수 + 데이터 제공 승인
Audit Log 변경 + 검증
```

## 33.4 Break-glass Access

긴급 상황에서 높은 권한을 사용할 수 있으나:

- 시간 제한
- 이유 입력
- 2차 승인 또는 사후 검토
- 모든 접근 기록
- 자동 만료

를 적용한다.

## 33.5 운영자 계정 보안

- 강한 MFA·Passkey 후보
- 공유 계정 금지
- Session 제한
- 민감 Queue 재인증
- Device 정책
- Access Review
- 퇴사·역할 변경 즉시 회수

## 33.6 내부자 오용

탐지 후보:

- 유명 사용자 기록 반복 조회
- 정치 Choice 대량 조회
- 업무와 무관한 Export
- Audit Log 접근 이상
- 대량 Override
- 야간 Break-glass 반복

내부 오용도 일반 사용자 공격과 동일하게 Incident 대상이다.

---
# 34. Audit Log·Evidence·보존

## 34.1 Audit 원칙

주요 운영 조치는 나중에 재구성할 수 있어야 한다.

```text
누가
언제
어떤 대상에
어떤 정책으로
어떤 근거를 보고
무슨 조치를 했고
무엇이 바뀌었는가
```

## 34.2 Audit 대상

- 게시 승인·거절
- 콘텐츠 수정 요청
- Label·노출 축소·제거
- Thread·Issue Lock
- 추천·결과 Freeze
- Vote·Reaction 무효화·복구
- Feature 제한
- 계정 경고·정지·복구
- Appeal 결정
- 정책 Version 변경
- 모델 배포·Rollback
- Legal Request 처리
- Break-glass Access
- Data Export

## 34.3 Audit Event 구조

```text
audit_event_id
actor_type
actor_id
role
case_id
target_type
target_id
before_state
after_state
action_code
policy_code
reason_code
policy_version
model_version
evidence_snapshot_id
created_at
review_required
reviewed_by
```

## 34.4 Append-only

Audit Log는 일반 Application Record처럼 덮어쓰지 않는다.

수정이 필요한 경우:

```text
기존 Event 유지
→ CORRECTION Event 추가
```

## 34.5 Evidence Snapshot

Case 판단 당시의 문맥을 보존한다.

```text
Content Text
Revision
Source Metadata
Relevant Thread
Report Summary
Integrity Summary
AI Output
Public State
```

외부 기사·SNS 원문 전체를 무단 복제하는 방식은 피하고 필요한 범위의 Metadata·Hash·스크린샷 또는 법적으로 허용된 Evidence를 사용한다.

## 34.6 Evidence 접근

Evidence에는 민감정보가 포함될 수 있으므로:

- Role-based Access
- Access Log
- Export 제한
- Watermark 후보
- 다운로드 승인
- 보존 만료

을 적용한다.

## 34.7 보존 기간 초기안

| 데이터 | 초기 후보 | 비고 |
|---|---:|---|
| 일반 신고·판정 Case | 1년 | 운영·Appeal 분석 |
| 일반 Appeal | 1~2년 | 재발·품질 QA |
| 계정 중대 제재 | 2~3년 | 법률 검토 필요 |
| 정치·선거 Audit | 법률 요건에 맞춤 | 별도 Legal Hold 가능 |
| 아동·성적 안전 | 법률·안전 기준 | 접근 제한 강화 |
| 원본 IP Security Log | 7~30일 | 최소화 |
| 회전형 Network HMAC | 30~90일 | Integrity 용도 |
| Model Input Snapshot | 최소 필요 기간 | 민감정보 제거 |
| Transparency Aggregate | 장기 | 개인 식별 불가 |

실제 기간은 개인정보 처리 목적·법적 의무·분쟁 기간을 검토해 확정한다.

## 34.8 삭제·보존 충돌

사용자 삭제 요청이 들어와도 다음은 법적 근거 또는 분쟁·안전상 필요에 따라 분리될 수 있다.

```text
Profile 데이터 삭제
Content 익명화
Moderation Evidence 제한 보존
Legal Hold 유지
Aggregate 비식별 통계 유지
```

## 34.9 Audit 검토

정기적으로 다음을 점검한다.

- 강한 조치의 2인 승인 누락
- 이유 없는 Override
- 정책 Version 불일치
- Reviewer 과도한 Remove
- 특정 Side 편향
- Break-glass Access
- 민감정보 조회
- 복구 누락

---

# 35. 정책 변경 관리

## 35.1 Policy Lifecycle

```text
DRAFT
→ INTERNAL_REVIEW
→ LEGAL_PRIVACY_REVIEW
→ TRAINING
→ ANNOUNCED
→ EFFECTIVE
→ MONITORED
→ REVISED
→ RETIRED
```

모든 정책에는 Version과 시행일을 둔다.

## 35.2 변경 유형

### Minor

- 문구 명확화
- 예시 추가
- Reason Code 이름 정리

### Material

- 허용·금지 범위 변경
- 새 제재 도입
- 정치·선거 정책 변경
- 개인정보 활용 변경
- Appeal 권한 축소
- 자동 조치 확대

Material Change는 더 강한 검토와 사용자 고지가 필요하다.

## 35.3 소급 적용

원칙적으로 새로운 정책을 과거 콘텐츠에 소급해 제재하지 않는다.

예외 후보:

- 현재도 계속되는 중대한 피해
- 불법 콘텐츠
- 아동·성적 착취
- Doxxing
- 계정 탈취·사기
- 법적 의무

소급 조치 시 이유를 Audit한다.

## 35.4 Reviewer 교육과 Tool 동기화

정책 시행 전:

```text
Policy 문서
Reviewer Guide
Gold Set
Reason Code
Admin UI
User Notice
Appeal 기준
Model Rule
QA Dashboard
```

를 동기화한다.

## 35.5 긴급 정책 변경

SEV-1 상황에서는 임시 Rule을 적용할 수 있다.

```text
TEMP_POLICY
expires_at
owner
scope
reason
review_date
```

임시 Rule은 자동으로 영구 정책이 되지 않는다.

---

# 36. 투명성 보고

## 36.1 목적

투명성 보고는 다음을 설명한다.

- 어떤 콘텐츠를 관리하는가
- 어떤 방식으로 탐지하는가
- 어떤 조치를 했는가
- 얼마나 이의 제기가 있었는가
- 얼마나 복구했는가
- 정치·선거·조작 사건을 어떻게 다뤘는가

## 36.2 공개 지표 후보

```text
신고 건수
고유 신고 대상
정책별 조치 건수
Issue·Comment·Account별 조치
자동·인간 판정 비율
Appeal 수
Appeal 인용률
평균 처리 시간
복구 건수
법적 요청 건수 범위
정치·선거 Incident 수
대규모 Vote 무효화 Case 수
```

## 36.3 공개하지 않을 정보

- 공격자가 우회할 수 있는 탐지 Threshold
- Reviewer 개인정보
- 피해자 개인정보
- 정치 Choice 원자료
- 소규모 집단을 재식별할 수 있는 통계
- 수사·법률상 비공개 정보

## 36.4 정치 투명성

향후 정치 기능을 제공한다면 별도 섹션을 둔다.

- 게시된 정치 Issue 수
- 거절된 정치 Candidate 수
- Election Mode 기간
- 결과 Lock·Ranking Freeze 건수
- 조직적 유입 Incident
- 법적 검토·기관 문의 범주
- 정치 선택 데이터 사용 금지 정책

## 36.5 정정 보고

중대한 오판·모델 오류·대량 복구가 발생하면 다음을 공개할 수 있다.

```text
무슨 일이 있었는가
영향 범위
복구 조치
재발 방지
```

개별 사용자의 민감정보는 제외한다.

---

# 37. 운영 SLA·Capacity·On-call

## 37.1 SLA 원칙

모든 신고를 같은 시간 안에 처리하는 것이 아니라 위험도에 따라 목표를 다르게 둔다.

## 37.2 초기 SLA 후보

| Queue | 1차 확인 목표 |
|---|---:|
| 생명·임박한 위협 | 15분 이내 후보 |
| 아동·성적 착취 | 15분~1시간 후보 |
| Doxxing·비동의 이미지 | 1시간 후보 |
| 정치·선거 긴급 Incident | 1시간 후보 |
| 고노출 HIGH Issue | 4시간 후보 |
| 일반 Comment 신고 | 24~72시간 후보 |
| 품질·중복 | 3~7일 후보 |
| 일반 Appeal | 7일 후보 |
| 계정·정치 Appeal | 7~14일 후보 |

실제 SLA는 운영 인력과 법적 요건에 맞춰 확정한다.

## 37.3 Queue Health

측정 항목:

- Open Case
- Aging
- SLA Breach
- Queue별 유입률
- Reviewer 처리량
- Reopen
- Escalation
- Backlog Forecast

## 37.4 Capacity Planning

```text
예상 Active User
× 신고율
× Comment 작성률
× Issue 생성률
× Auto Escalation 비율
× 평균 검수 시간
```

으로 필요한 운영 인력을 산정한다.

정치 기능은 별도 인력 없이 활성화하지 않는다.

## 37.5 On-call

MVP 이후 다음 On-call을 분리할 수 있다.

```text
Safety
Integrity
Security
Legal
Platform
ML
```

초기에는 한 사람이 여러 역할을 맡더라도 Escalation 연락망과 결정권자를 명시한다.

## 37.6 Feature Launch와 Coverage

다음 Feature는 Moderator Coverage가 없으면 출시하지 않는다.

- 사용자 Issue 생성
- 댓글
- 정치·선거
- 이미지 업로드
- Profile 자유 링크
- DM 또는 Group
- 현금 보상

---

# 38. 모더레이션 지표와 Guardrail

## 38.1 핵심 품질 지표

```text
Policy Precision
Policy Recall 후보
Human Agreement
Appeal Overturn
Time to Action
Restoration Completeness
Repeat Violation
```

## 38.2 Safety KPI

- 고위험 콘텐츠 노출 전 차단률
- 고위험 콘텐츠 평균 노출 시간
- Doxxing 제거 시간
- 아동 안전 Escalation 시간
- 중대한 False Negative
- 피해자 반복 신고율
- 재업로드 차단률

## 38.3 Issue Governance KPI

- Candidate Reject Rate
- Edit Request Success Rate
- Leading Question Detection
- Binary Asymmetry Rate
- Source Problem Rate
- Material Correction Rate
- Restricted General Queue Leakage
- 첫 투표 후 의미 변경 사고

## 38.4 Comment KPI

- Comment Report Rate
- Side별 Report Rate
- Side별 Remove Rate
- Side별 Appeal Overturn
- Constructive Reply Rate
- Thread Lock Rate
- Spam Rate
- Block·Hide Rate

## 38.5 신고 악용 KPI

- Report Brigading Case
- Abusive Report Rate
- Duplicate Report Rate
- 신고 수 대비 실제 위반
- Reporter Cluster 탐지
- 신고로 인한 잘못된 자동 Hide

## 38.6 정치·선거 KPI

- Political Classification Recall
- General Feed Leakage
- Election Mode 위반
- 법적 검토 누락
- 외부 Burst 탐지 시간
- Result Lock 시간
- 정치 Choice 데이터 접근 건수
- 정치 Appeal Overturn

## 38.7 자동화 KPI

- AI vs Human Agreement
- Policy별 False Positive
- Policy별 False Negative 후보
- 자동 조치 Overturn
- 모델 Drift
- 설명 누락률
- Model Rollback 횟수

## 38.8 Guest 유입 Guardrail

모더레이션·안전 기능이 외부 유입을 과도하게 막지 않는지 다음을 함께 본다.

```text
External First Vote Conversion
Time to First Vote
Challenge Rate for LOW Guest
False Challenge Rate
Deep-link Bounce Before Vote
First Result View Rate
Next Issue Rate
Guest Report Completion
```

**[확정]** LOW Risk 외부 Guest의 정상 첫 투표 전환이 악화되면 안전 Rule의 Precision·적용 시점을 재검토한다.

단, 전환율을 높이기 위해 고위험 안전 Rule을 완화하지 않는다.

## 38.9 건강한 성장 Guardrail

```text
Engagement 증가
+
Safety 악화 없음
+
Diversity 유지
+
Integrity 유지
+
Appeal 품질 유지
```

를 함께 충족해야 한다.

---

# 39. 실험 정책

## 39.1 실험 가능한 항목

- 신고 UI Reason 순서
- 수정 요청 문구
- Comment Slow Mode 길이
- 경미한 댓글 Collapse 기준
- Reviewer UI 정보 배치
- Guest 신고 Challenge 시점
- Warning 교육 문구
- Appeal Form 단순화

## 39.2 제한적 실험

다음은 Safety·Legal 승인이 필요하다.

- 자동 Hide 확대
- 자동 Account 제한
- 정치 Surface
- 미성년자 기능
- Profile 이미지 업로드
- Public Follower Count
- Comment Reply Depth
- AI 수정안 자동 적용

## 39.3 금지 실험

```text
정치 A/B Choice 기반 개인화
신고 수만으로 자동 삭제
고위험 Rule 완화로 Engagement 증가 측정
Appeal 경로 숨기기
결과 확인을 대가로 신고·가입 요구
A/B Side에 다른 정책 적용
정치 좌표찍기 콘텐츠를 Trending 실험에 사용
피해자 개인정보 노출 실험
```

## 39.4 실험 Stop Condition

- 고위험 노출 증가
- Appeal Overturn 급증
- 특정 Side 제재 불균형
- Guest First Vote 급락
- 신고 악용 증가
- 정치 일반 Feed Leakage
- Reviewer SLA 붕괴
- 개인정보 사고

---

# 40. 단계별 구현 범위

## 40.1 Moderation v0 — 비공개 Alpha

```text
운영자 Issue만 게시
Guest Vote
댓글 비활성 또는 제한
기본 금칙 Rule
Issue Human Review
신고 접수
Audit Log
Manual Restore
정치·선거 비활성
```

## 40.2 Moderation v1 — MVP

```text
Member 댓글
Comment Automod + Human Queue
Issue·Comment 신고
Guest 안전 신고
Profile 기본 Moderation
Risk Level Queue
Reason Code
User Notice
Appeal 기본
Account Warning·Cooldown
Spam·Doxxing·Threat 긴급 Queue
Incident Freeze
Guest 유입 Guardrail Dashboard
```

## 40.3 Moderation v1.1

```text
사용자 Issue 생성
Creator Premoderation
Creator Reputation 연동
Comment Ranking Safety Signal
Block·Mute·Hide
Policy QA Dashboard
Automated Decision 설명
Model Shadow Evaluation
```

## 40.4 Moderation v1.2

```text
ML-assisted Triage
Report Brigading 탐지
고급 Integrity 연동
Transparency Report
정교한 Appeal 복구
공식 Account 인증
이미지 Moderation 후보
```

## 40.5 정치·선거 활성화 별도 Gate

버전 숫자와 무관하게 다음을 모두 충족해야 한다.

- 법률 검토 완료
- 선거관리 관련 의무 확인
- Verified Eligibility
- Political Editorial Queue
- 2인 승인
- Election Mode
- Blackout·공표 제한 처리
- 정치 결과·공유 UI
- 정치 Sensitive Data 통제
- Integrity On-call
- Transparency Reporting

하나라도 준비되지 않으면 비활성 상태를 유지한다.

---

# 41. 운영 Playbook 요약

## 41.1 조직적 댓글 공격

```text
Burst 탐지
→ Slow Mode
→ 신규 Comment Premoderation
→ Reaction Freeze 후보
→ Cluster 분석
→ Thread Lock
→ Account 조치
→ 정상 댓글 복구
```

## 41.2 허위 출처 기반 인기 Issue

```text
Source 경고
→ 신규 Vote 제한
→ 추천 제외
→ Fact Review
→ 배경 정정 / Issue 종료
→ 사용자 통지
→ Successor 생성 후보
```

## 41.3 Creator의 반복 편향 질문

```text
Edit Request
→ Posting Cooldown
→ Creator Premoderation
→ Issue Creation Suspension
→ Reputation 재평가
```

## 41.4 혐오 밈 대량 유입

```text
Pattern Rule 생성
→ Auto Collapse·Hide
→ Account Cluster 분석
→ Reupload 방지
→ Policy QA
→ Rule 만료·검토
```

## 41.5 잘못된 AI 판정

```text
Human Overturn 증가 탐지
→ Auto Action 중단
→ Model Shadow 전환
→ 영향 Target 복구
→ Dataset 정정
→ 재평가
```

## 41.6 신고 공격

```text
Report Burst 탐지
→ 신고 Weight 축소
→ Auto Hide 중단
→ Target 독립 Review
→ Reporter Cluster 조치
```

## 41.7 개인정보 유출

```text
SEV-1 선언
→ 접근 차단
→ Evidence 보존
→ 유출 범위 확인
→ 법률·개인정보 담당 Escalation
→ 사용자·기관 통지 검토
→ Credential·Access 회수
→ Postmortem
```

---

# 42. QA 시나리오

## 42.1 Issue QA

- LOW 유희형 질문이 자동 품질 검사를 통과한다.
- 선택지 A만 도덕적으로 우월한 질문은 Edit Request된다.
- 정치 후보 이름이 들어간 Issue가 일반 Queue로 가지 않는다.
- 첫 Vote 후 A/B 의미 수정이 차단된다.
- Source 철회 시 관련 Issue가 재검토된다.
- 중복 Issue가 Cluster로 묶인다.

## 42.2 Comment QA

- A와 B에 동일한 욕설을 적용했을 때 같은 조치가 나온다.
- 반박 목적의 인용이 원 작성자의 혐오 표현으로 오인되지 않는다.
- Doxxing 정보가 즉시 Hide된다.
- 공감 수가 높아도 위반 댓글은 상단에 남지 않는다.
- 댓글 삭제 후 답글 구조가 깨지지 않는다.

## 42.3 신고 QA

- 같은 대상 반복 신고가 Case 하나로 묶인다.
- Guest가 긴급 신고를 제출할 수 있다.
- 조직적 신고 Burst로 콘텐츠가 자동 삭제되지 않는다.
- 신고자가 A/B 어느 Side인지 Reliability에 사용되지 않는다.

## 42.4 Appeal QA

- 원 판정자와 다른 Reviewer가 Appeal을 처리한다.
- 복구 시 Reputation·Badge·추천 Eligibility가 함께 돌아온다.
- 자동 조치 사용자가 인간 검토를 요청할 수 있다.
- Appeal 승인 후 사용자 통지가 발송된다.

## 42.5 정치 QA

- 정치 Issue가 Guest Cold Start에 노출되지 않는다.
- 정치 A/B Choice가 Interest Feature에 들어가지 않는다.
- Election Mode에서 신규 게시·공유·결과 규칙이 적용된다.
- 외부 Burst 시 Ranking이 Freeze된다.
- 법률 검토가 없으면 Election Poll 기능이 Fail-Closed된다.

## 42.6 Guest 전환 QA

- 외부 LOW Issue에서 첫 Vote 전 Moderation Prompt가 없다.
- 정상 Guest에게 불필요한 CAPTCHA가 반복되지 않는다.
- 위험한 Guest 요청만 Step-up Challenge된다.
- 신고 기능이 첫 Vote UI를 가리지 않는다.

## 42.7 Audit QA

- 모든 강한 조치에 Reason·Policy Version이 있다.
- 2인 승인 대상이 단일 승인으로 처리되지 않는다.
- Break-glass Access가 자동 만료된다.
- 삭제된 Audit Event가 없는지 검증한다.

---

# 43. 미결정 사항

## 43.1 법률·정책

- MVP 최소 가입 연령
- 만 14세 미만 가입 제공 여부
- 정치·선거 Issue 제공 여부
- 공직선거법상 WHICH 기능의 구체적 분류
- 선거여론조사심의 관련 신고·등록 의무
- 정치 결과 공표 제한 기간 적용
- 명예훼손·임시조치 운영 절차
- 저작권 Counter Notice 절차
- 법적 요청 투명성 범위

## 43.2 Comment

- 답글에도 Accepted Vote를 요구할지
- 최대 Comment 길이
- 수정 가능 시간
- Thread 최대 깊이
- Slow Mode 기본값
- Guest 신고의 최종 범위

## 43.3 자동화

- 어떤 LOW 정책을 Auto Action할지
- Auto Hide Confidence 기준
- 외부 Moderation Provider
- 모델 재학습 주기
- 정치 분류 모델의 운영 방식
- 완전 자동 결정의 범위

## 43.4 제재

- 공개 Strike 제공 여부
- 조치별 정확한 기간
- Account Termination 기준
- Creator Reputation 감점·복구 수식
- Follower·Reaction 조작 Threshold

## 43.5 데이터

- Audit 보존 기간
- 정치 Choice 보존 기간
- 원본 IP 보존 기간
- 계정 삭제 시 댓글·Issue 처리
- Profile 이미지 직접 업로드 시점
- Transparency Report 주기

## 43.6 운영

- Queue별 실제 SLA
- 24시간 On-call 필요 시점
- 정치·선거 전담 인력
- 외부 법률·선거 전문가 계약
- Reviewer Wellness 지원
- 2인 승인 대상 최종 목록

---

# 44. 문서 간 의존성과 다음 설계로의 인계

## 44.1 이전 문서와의 연결

| 문서 | 연결 내용 |
|---|---|
| 01 제품 비전 | 안전과 신뢰 우선, 의견이 아닌 피해 행동 관리 |
| 02 UX | 오류·잠금·삭제·Appeal 상태 UX |
| 03 공급 | Candidate 검수, Source, 정정·Successor |
| 04 Taxonomy | Risk Level, 정치 Fail-Closed, Quality Gate |
| 05 Identity·Integrity | Vote 상태, 좌표찍기, 정치 Eligibility |
| 06 관심사 | 정치 Choice Feature 금지, Guest 유입 보호 |
| 07 추천·ML | Eligibility·Safety·Integrity Re-ranking |
| 08 Social | A/B Comment, Profile 비공개, Follow·Reputation |

## 44.2 다음 문서로 넘길 항목

`10_METRICS_ANALYTICS_AND_EXPERIMENTS.md`에서 구체화할 항목:

- Moderation Funnel
- Queue SLA Dashboard
- Guest Safety Friction 지표
- Side Fairness 지표
- Appeal Overturn
- Incident Metric
- 정치 Leakage
- 모델 Precision·Recall
- 실험 Stop Condition
- Transparency Aggregate

## 44.3 기술 설계로 넘길 객체

향후 DB·API 설계 대상:

```text
policy_versions
moderation_cases
moderation_targets
moderation_decisions
moderation_actions
reports
report_clusters
appeals
appeal_decisions
audit_events
evidence_snapshots
legal_requests
legal_holds
incidents
incident_actions
reviewer_assignments
model_assessments
user_notices
transparency_aggregates
```

---
# 부록 A. Policy·Reason Code 카탈로그

## A.1 정책 코드

| 코드 | 정책 |
|---|---|
| `P_ILLEGAL` | 불법 콘텐츠·법적 금지 |
| `P_VIOLENCE` | 폭력·위협 |
| `P_SELF_HARM` | 자살·자해 위험 |
| `P_HATE` | 혐오·차별·비인간화 |
| `P_HARASSMENT` | 괴롭힘·모욕·표적 공격 |
| `P_PRIVACY` | 개인정보·Doxxing |
| `P_SEXUAL` | 성적 콘텐츠·비동의 이미지 |
| `P_CHILD_SAFETY` | 아동·청소년 안전 |
| `P_FALSE_PREMISE` | 허위·왜곡 전제 |
| `P_SOURCE` | Source Integrity |
| `P_SPAM` | Spam·도배 |
| `P_MANIPULATION` | 플랫폼·투표·반응 조작 |
| `P_IMPERSONATION` | 사칭 |
| `P_FRAUD` | 사기·피싱·악성 링크 |
| `P_COPYRIGHT` | 저작권·권리 |
| `P_POLITICAL` | 정치 정책 |
| `P_ELECTION` | 선거 정책 |
| `P_ISSUE_QUALITY` | 질문·A/B 품질 |
| `P_PROFILE` | Profile 정책 |
| `P_CIRCUMVENTION` | 제재 우회 |

## A.2 이유 코드 예시

```text
LEADING_LANGUAGE
CHOICE_ASYMMETRY
MULTI_ISSUE_QUESTION
FALSE_FACTUAL_PREMISE
SOURCE_MISSING
SOURCE_RETRACTED
TARGETED_INSULT
REPEATED_HARASSMENT
PROTECTED_CLASS_ATTACK
DEHUMANIZATION
CREDIBLE_THREAT
DOXXING_ADDRESS
PRIVATE_PHONE_NUMBER
NONCONSENSUAL_INTIMATE_IMAGE
MINOR_IDENTIFICATION
COPY_PASTE_SPAM
MALICIOUS_LINK
FAKE_OFFICIAL_ACCOUNT
COORDINATED_REPORTING
COORDINATED_VOTING
POLITICAL_GENERAL_QUEUE_LEAK
ELECTION_POLL_LEGAL_REVIEW_REQUIRED
SANCTION_EVASION
```

## A.3 Action 코드

```text
NO_ACTION
NOTICE
LABEL
EDIT_REQUIRED
DEPRIORITIZE
COLLAPSE
HIDE_PENDING_REVIEW
REMOVE_POLICY
REMOVE_LEGAL
LOCK_THREAD
DISABLE_NEW_VOTES
FREEZE_RANKING
LOCK_RESULT
LIMIT_FEATURE
WARN_ACCOUNT
SUSPEND_ACCOUNT
TERMINATE_ACCOUNT
RESTORE
CREATE_SUCCESSOR
```

---

# 부록 B. 객체별 Action Matrix

| Target | 경미 | 중간 | 높음 | Critical |
|---|---|---|---|---|
| Issue | Edit Request | 추천 제외·수정 | Suspend·Vote 제한 | Remove·Incident |
| Comment | Deprioritize | Collapse·Remove | Thread Lock·Feature 제한 | Remove·Account 조치 |
| Profile | 수정 요구 | 숨김·Link 제한 | Profile 비공개·Read-only | Account 정지 |
| Creator | Warning | Premoderation | 생성 정지 | Account 정지 |
| Vote | Duplicate 제외 | Review | Invalidate Cluster | Result Lock·Incident |
| Reaction | Count 제외 | Rate Limit | Cluster 무효화 | Feature 정지 |
| Report | Deduplicate | Weight 축소 | Reporter 제한 | Account 정지 |
| Source | Label | 재검토 | Issue 중단 | 관련 Issue 전수 조사 |

**주의:** Severity가 같아도 맥락·고의성·피해 범위에 따라 Action이 달라질 수 있다.

---

# 부록 C. 사용자 통지 템플릿

## C.1 Issue 수정 요청

```text
제목: 이슈 수정이 필요합니다

현재 질문은 게시 전 수정이 필요합니다.

적용 기준
{policy_name}

확인된 문제
{reason_summary}

수정 제안
{edit_guidance}

현재 상태
수정 후 다시 제출할 수 있습니다.

[이슈 수정]
[결정에 이의 제기]
```

## C.2 Comment 제거

```text
제목: 댓글이 정책에 따라 숨김 처리되었습니다

대상 댓글
{comment_excerpt}

적용 정책
{policy_name}

조치
{action}

기간
{duration_or_permanent}

[정책 확인]
[이의 제기]
```

## C.3 계정 기능 제한

```text
제목: 일부 기능이 일시적으로 제한되었습니다

제한 기능
{feature_list}

이유
{reason_summary}

종료 예정
{expires_at}

제한 중에도 가능한 기능
{available_features}

[세부 내용]
[이의 제기]
```

## C.4 Appeal 승인

```text
제목: 이의 제기가 승인되었습니다

검토 결과 기존 조치가 취소 또는 완화되었습니다.

복구된 항목
{restored_items}

복구 시점
{restored_at}

추천·성과 지표 반영에는 잠시 시간이 걸릴 수 있습니다.
```

## C.5 결과 잠금

```text
현재 투표 결과를 검토하고 있습니다.

신규 참여 또는 외부 유입에서 비정상 패턴이 감지되어
결과 표시를 일시적으로 잠갔습니다.

이슈 내용이 위반이라는 의미는 아닙니다.
검토가 끝나면 결과를 갱신합니다.
```

## C.6 Source 정정

```text
이 이슈의 배경 정보가 수정되었습니다.

변경 이유
원출처의 정정 또는 추가 정보가 확인되었습니다.

투표 해석에 미치는 영향
{impact_level}

{successor_issue_link_if_any}
```

---

# 부록 D. Reviewer 체크리스트

## D.1 Issue 검수

- [ ] 질문이 하나의 판단 축을 다루는가
- [ ] A/B가 직접 답변인가
- [ ] A/B 표현 강도와 범위가 대등한가
- [ ] 허위·왜곡 전제가 없는가
- [ ] Background와 Source가 일치하는가
- [ ] 특정 개인·집단 공격이 아닌가
- [ ] 개인정보·피해자 식별 위험이 없는가
- [ ] 정치·선거 관련성을 확인했는가
- [ ] 유사·중복 Issue를 확인했는가
- [ ] 첫 Vote 이후 변경 금지 항목을 이해했는가
- [ ] 게시·만료·재검토 정책이 지정됐는가

## D.2 Comment 검수

- [ ] 의견 비판인가 사람 공격인가
- [ ] 보호 대상 집단에 대한 공격인가
- [ ] 구체적 위협인가
- [ ] 개인정보가 포함됐는가
- [ ] 인용·반박 맥락을 확인했는가
- [ ] A/B Side에 동일 기준을 적용했는가
- [ ] 삭제 대신 축소가 충분한가
- [ ] Thread Lock이 필요한가
- [ ] 사용자 통지 Reason이 명확한가

## D.3 정치·선거 검수

- [ ] `PUBLIC_POLICY / POLITICAL / ELECTION`을 구분했는가
- [ ] 후보·정당·선거를 직접 다루는가
- [ ] 법률 검토가 필요한 조사 형식인가
- [ ] Source가 복수이고 최신인가
- [ ] 질문·A/B가 중립적인가
- [ ] 공표·게시 제한 기간을 확인했는가
- [ ] Eligibility가 지정됐는가
- [ ] 추천·공유·결과 정책이 지정됐는가
- [ ] 2인 승인을 받았는가
- [ ] 개인 정치 Choice 보호가 적용됐는가

## D.4 Appeal 검수

- [ ] 원 결정과 독립적으로 검토했는가
- [ ] 당시 Policy Version을 확인했는가
- [ ] 새로운 Evidence를 확인했는가
- [ ] 자동 모델 오류 가능성을 검토했는가
- [ ] 동일 Case와 일관적인가
- [ ] 복구 대상 전체를 지정했는가
- [ ] 사용자 설명이 충분한가

## D.5 Incident 체크리스트

- [ ] Severity를 선언했는가
- [ ] Incident Owner가 있는가
- [ ] 피해 확산을 제한했는가
- [ ] Evidence를 보존했는가
- [ ] Legal·Privacy·Security Escalation을 검토했는가
- [ ] 사용자 통지를 검토했는가
- [ ] 복구 항목을 추적하는가
- [ ] Postmortem 기한이 있는가

---

# 부록 E. Moderation Case 구조 예시

```json
{
  "case_id": "MOD-20260817-000123",
  "target": {
    "type": "ISSUE",
    "id": "ISS-1024",
    "revision": 3
  },
  "trigger": {
    "type": "REPORT_CLUSTER",
    "report_count": 84,
    "unique_reporters": 61,
    "brigading_risk": 0.72
  },
  "classification": {
    "category": "WORK_CAREER",
    "risk_level": "MEDIUM",
    "political_class": "NONE"
  },
  "automated_assessment": {
    "model_version": "moderator_v1.3",
    "policy_version": "moderation_policy_v2",
    "labels": [
      {
        "code": "LEADING_LANGUAGE",
        "confidence": 0.91,
        "severity": "MEDIUM"
      }
    ]
  },
  "human_decision": {
    "reviewer_role": "MODERATOR",
    "action": "EDIT_REQUIRED",
    "reason_code": "LEADING_LANGUAGE",
    "decided_at": "2026-08-17T14:00:00+09:00"
  },
  "notice": {
    "notice_id": "NTC-20260817-00123",
    "appeal_eligible": true
  },
  "audit": {
    "evidence_snapshot_id": "EVD-9012",
    "policy_version": "moderation_policy_v2"
  }
}
```

---

# 부록 F. 투명성 보고 템플릿

```text
WHICH 투명성 보고서 — {기간}

1. 서비스 규모
   - Active User
   - Published Issue
   - Comment
   - Accepted Vote

2. 신고
   - 총 신고
   - 고유 Target
   - 정책별 신고
   - Guest 신고

3. 조치
   - Issue
   - Comment
   - Account
   - 자동·인간 판정

4. 이의 제기
   - 제출
   - 인용
   - 부분 인용
   - 평균 처리 시간

5. Integrity
   - Vote 무효화 Case
   - Report Brigading
   - Reaction 조작

6. 정치·선거
   - 게시·거절
   - Election Mode
   - Ranking Freeze
   - 법적 요청 범주

7. 중대한 사고
   - 유형
   - 영향
   - 복구

8. 정책·모델 변경
   - 주요 변경
   - 시행일
```

---

# 부록 G. 공식 참고 기준

> 아래 자료는 운영 설계 참고용이며, WHICH에 대한 개별 법률 자문을 대체하지 않는다.

## G.1 대한민국 법령·개인정보

- 대한민국 공직선거법, 국가법령정보센터
  - 선거에 관한 여론조사, 모의투표·인기도 조사, 질문 편향, 결과 공표 제한과 기록 의무를 검토할 때 참고
- 개인정보 보호법, 국가법령정보센터
  - 민감정보, 아동 개인정보, 자동화된 결정 관련 권리 검토
- 개인정보보호위원회·개인정보 포털 안내
  - 온라인 서비스 로그, 아동·청소년 개인정보, 자동화된 결정 안내 참고

## G.2 AI Risk·Human Oversight

- NIST AI Risk Management Framework: Generative AI Profile
  - 인간 검수, 실시간 감시, Appeal·Override, Incident Response, Transparency 참고

## G.3 플랫폼 Governance 벤치마크

- European Commission Digital Services Act Transparency Database·Complaint 안내
  - 조치 사유, 내부 불만 처리, 투명성 보고 참고
- X Rules and Enforcement
  - Label·Visibility 제한·Feature 제한·Appeal 참고
- Meta Transparency Center
  - Remove·Reduce·Inform 구조 참고
- YouTube Community Guidelines Enforcement
  - Warning·Strike·Human Review·Appeal·Transparency 참고

## G.4 참고 링크

- 국가법령정보센터 공직선거법: https://www.law.go.kr/법령/공직선거법
- 국가법령정보센터 개인정보 보호법: https://www.law.go.kr/법령/개인정보보호법
- NIST AI RMF Generative AI Profile: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- EU DSA Transparency Database: https://transparency.dsa.ec.europa.eu/

---

# 부록 H. 결정 상태 요약

## H.1 확정

- [x] 의견 자체보다 피해 행동·표현·조작을 관리한다.
- [x] 신고 수만으로 자동 삭제하지 않는다.
- [x] HIGH·RESTRICTED는 인간 검수를 우회하지 않는다.
- [x] 중대한 자동 조치에는 인간 재검토 경로를 둔다.
- [x] Issue·Comment·Feature·Account 제재를 분리한다.
- [x] 조치 사유와 Appeal 경로를 제공한다.
- [x] Appeal 승인 시 추천·Reputation·ML 데이터까지 복구한다.
- [x] 정치·선거는 별도 Governance Domain이다.
- [x] 정치 A/B Choice를 개인화·광고·Opinion Graph에 사용하지 않는다.
- [x] LOW Risk 외부 Guest의 첫 투표를 불필요하게 방해하지 않는다.
- [x] 운영 조치는 Audit 가능해야 한다.
- [x] 정치·선거 기능은 준비되지 않으면 Fail-Closed한다.

## H.2 설계 기준

- [ ] Guest 안전 신고 허용
- [ ] Blind Review Mode
- [ ] 2인 승인 대상
- [ ] Remove·Reduce·Inform 체계
- [ ] Reviewer Calibration
- [ ] Transparency Report
- [ ] Incident Severity·Playbook
- [ ] 자동 결정 설명과 인간 재검토

## H.3 초기안

- [ ] Queue별 SLA
- [ ] Comment 수정 10분
- [ ] 제재 기간
- [ ] Audit 보존 기간
- [ ] Guest 신고 Rate Limit
- [ ] Auto Action 범위
- [ ] MVP 최소 연령
- [ ] Transparency Report 주기

## H.4 미정

- [ ] 정치·선거 Surface를 실제 제공할지
- [ ] 선거 관련 법적 분류와 신고·등록 의무
- [ ] 만 14세 미만 서비스 제공 여부
- [ ] 공개 Strike 도입 여부
- [ ] Profile 이미지 업로드 시점
- [ ] 외부 Moderation Provider
- [ ] Account 삭제 시 공개 콘텐츠 처리
- [ ] 정치 댓글 제공 여부

## H.5 문서 확정 체크리스트

- [ ] Policy Owner 검토
- [ ] Product Owner 검토
- [ ] Legal 검토
- [ ] Privacy 검토
- [ ] Security·Integrity 검토
- [ ] ML·Data 검토
- [ ] Operations Capacity 검토
- [ ] 사용자 통지 문구 검토
- [ ] Appeal 복구 테스트
- [ ] Guest First Vote Guardrail 테스트
- [ ] 정치·선거 Fail-Closed 테스트
- [ ] 기존 01~08 문서와 용어 동기화

---

# 최종 요약

WHICH의 Moderation & Governance는 다음 순서로 작동한다.

```text
Content·Behavior 입력
        ↓
Eligibility·정책 검사
        ↓
AI 분류·우선순위화
        ↓
Risk에 따른 인간 검수
        ↓
Inform / Reduce / Remove / Restrict
        ↓
사용자 사유 통지
        ↓
Appeal·복구
        ↓
Audit·QA·투명성 보고
```

정치·선거는 별도 경로를 사용한다.

```text
Political Detection
→ Fail-Closed
→ Source·Neutrality·Legal Review
→ 2인 승인
→ 별도 Eligibility·추천·결과 정책
→ 강화 Integrity
→ Election Mode
```

Guest의 정상적인 첫 참여는 다음처럼 보호한다.

```text
LOW Risk 외부 딥링크
→ 가입·관심사·모더레이션 방해 없이 첫 Vote
→ 결과 확인
→ 위험이 있을 때만 Step-up Challenge
```

따라서 WHICH는 참여를 가볍게 유지하되, 위험이 높아질수록 검수·인증·노출 제한·감사 수준을 높이는 구조를 채택한다.

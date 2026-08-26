# Question Archetype, Editorial Rubric, and Authoring Linter Contract

- Status: Accepted research contract
- Task: `WHICH-82`
- Last updated: 2026-08-26
- Related decision: [`ADR-0003: Issue format and media policy`](../architecture/adr/0003-issue-format-and-media-policy.md)
- Related roadmap: [`issue-format-image-and-poll-expansion-roadmap.md`](./issue-format-image-and-poll-expansion-roadmap.md)
- Notion plan: [Issue 형식·이미지·질문 품질 확장 계획 v1](https://app.notion.com/p/3c828b27a55981b99e9bcd461fd62d41)

## 문서 목적

이 문서는 외부 인기 질문을 복사하지 않고도 WHICH의 저맥락·저위험 A/B 질문을 안정적으로
작성하기 위한 질문 원형, 편집 품질 Rubric와 공통 Authoring Linter 계약을 정의한다. Member
작성기와 Ops 검수 화면은 같은 규칙 ID와 판정 결과를 사용하며, 화면별로 필요한 설명과 권한만
다르게 제공한다.

이 문서는 런타임 구현이나 자동 게시 권한을 승인하지 않는다. 먼저 공통 계약을 확정하고, 후속
구현에서 Shadow 검증과 사람 검수를 거쳐 적용한다.

## 핵심 원칙

1. 질문 품질을 하나의 100점 점수로 축약하지 않는다.
2. 자동 검사는 사실과 구조를 보조하며 의미·민감성·출처의 최종 승인을 대신하지 않는다.
3. 질문과 선택지는 1~2초 안에 독립적으로 이해할 수 있어야 한다.
4. A와 B는 같은 추상화 수준, 문법 구조와 표현 강도를 가져야 한다.
5. 외부 사례는 문장이 아니라 질문 구조를 참고하며 provenance와 변환 기록을 남긴다.
6. Linter 결과와 사람의 Editorial 결정은 분리해 저장한다.
7. 규칙, Threshold, 사전과 모델이 바뀌면 새 Rubric Version으로 재현할 수 있어야 한다.

## v1 질문 원형

원형 ID는 문장 Template가 아니라 질문의 참여 구조를 식별한다. 같은 원형 안에서도 주제,
상황과 선택지는 독립적으로 작성해야 한다.

### `QAR-VS-01` 생활 습관형

평소 실제로 반복하는 행동, 명칭 또는 생활 방식을 묻는다.

```text
평소 [상황]에서는 어느 쪽을 더 자주 하나요?
A. [행동 방식 A]
B. [행동 방식 B]
```

- 적합: 음식, 이동, 정리, 여가, 커뮤니케이션 습관
- 장점: 정답이 없고 경험 기반 댓글로 이어지기 쉽다.
- 주의: 특정 지역·세대의 방식을 이상하거나 뒤처진 것으로 표현하지 않는다.

### `QAR-VS-02` 직접 취향형

두 대상 또는 경험 중 개인 선호를 빠르게 선택한다.

```text
[공통 조건]이라면 어느 쪽이 더 끌리나요?
A. [대상 A]
B. [대상 B]
```

- 적합: 음식, 여행, 콘텐츠, 디자인, 소비와 취미
- 장점: 이해 비용이 낮아 첫 Feed에 적합하다.
- 주의: 한쪽만 구체적이거나 유명한 대상이면 단순 인지도 조사가 될 수 있다.

### `QAR-VS-03` 상황 판단형

짧고 구체적인 상황에서 가능한 두 행동을 고르게 한다.

```text
[한 문장의 상황]일 때 어떻게 하겠어요?
A. [행동 A]
B. [행동 B]
```

- 적합: 관계, 직장, 여행, 소비와 일상 문제 해결
- 장점: 사용자가 자기 경험을 대입하고 선택 이유를 말하기 쉽다.
- 주의: 불법·폭력·차별을 한쪽 선택지로 정상화하지 않는다.

### `QAR-VS-04` 손익 충돌형

양쪽 모두 이익과 비용이 있는 실제 Trade-off를 묻는다.

```text
[조건]이라면 어느 쪽을 선택하겠어요?
A. [이익 A + 비용 A]
B. [이익 B + 비용 B]
```

- 적합: 직장, 시간, 소비, 이동, 학습과 관계
- 장점: 어느 한쪽도 정답처럼 보이지 않아 이유 댓글의 밀도가 높다.
- 주의: 비현실적인 금액·기간이나 한쪽에만 숨은 비용을 두지 않는다.

### `QAR-VS-05` 자기분류형

사용자가 현재 자신에게 더 가까운 행동이나 성향을 선택한다.

```text
요즘 나는 어느 쪽에 더 가까운가요?
A. [관찰 가능한 상태·행동 A]
B. [관찰 가능한 상태·행동 B]
```

- 적합: 생활 리듬, 계획 방식, 소비 습관과 콘텐츠 이용
- 장점: 개인화에 사용할 수 있는 명시적 선호 신호를 만든다.
- 주의: 의학·심리 진단, 능력 서열, 낙인과 민감 특성 추론으로 표현하지 않는다.

### `QAR-VS-06` 후속형

이전 Issue의 결과나 선택에서 자연스럽게 다음 선택으로 이어진다.

```text
[부모 Issue 결과 또는 선택] 다음에는 무엇을 고를까요?
A. [후속 A]
B. [후속 B]
```

- 필수 연결: `parent_issue_id`, `parent_issue_version`, `follow_up_basis`
- 적합: 오늘의 승자 후속 대결, 선택 결과의 실행 방식, 공동제작 다음 단계
- 장점: 결과 확인 뒤 재방문과 연속 참여 이유를 만든다.
- 주의: 부모 Issue를 보지 않은 사용자도 한 문장 맥락으로 이해할 수 있어야 한다.

## 공통 Editorial Rubric

### 판정 수준

| Level            | 의미                     | Member 작성기     | Ops                      |
| ---------------- | ------------------------ | ----------------- | ------------------------ |
| `PASS`           | 문제 없음                | 별도 표시 없음    | 체크 완료 후보           |
| `ADVISORY`       | 품질 개선 권고           | 짧은 수정 제안    | 근거 확인 후 승인 가능   |
| `NEEDS_REVISION` | 의미 또는 균형 수정 필요 | 제출 전 수정 요구 | `NEEDS_CHANGES`          |
| `HUMAN_REVIEW`   | 자동 판정 불충분         | 안전한 일반 안내  | 운영자 확인 전 승인 금지 |
| `BLOCK`          | v1 금지 또는 구조 위반   | 제출 차단         | `REJECTED` 후보          |

여러 Finding이 있을 때 숫자 합계를 계산하지 않는다. 전체 Recommendation은 가장 강한 판정과
필수 규칙의 통과 여부로 계산하며, Ops 사람 결정이 이를 별도로 승인·수정·반려한다.

### 규칙 카탈로그

| Rule ID                        | 검사                                             | 자동화                                 | 기본 판정        |
| ------------------------------ | ------------------------------------------------ | -------------------------------------- | ---------------- |
| `STRUCTURE.VS_BINARY_FIT`      | 실제로 둘 중 하나를 고를 수 있는가               | 구조 Heuristic + 사람 확인             | `NEEDS_REVISION` |
| `CHOICE.SEMANTIC_DUPLICATE`    | A와 B가 같은 의미인가                            | 정규화·유사도 + 사람 확인              | `BLOCK`          |
| `CHOICE.LENGTH_PARITY`         | 길이 차이가 과도한가                             | 문자 수 Heuristic                      | `ADVISORY`       |
| `CHOICE.GRAMMAR_PARITY`        | 명사/행동/문장 형식이 대응하는가                 | 형태 Pattern + 사람 확인               | `NEEDS_REVISION` |
| `CHOICE.ABSTRACTION_PARITY`    | 구체적 행동과 감정처럼 층위가 다른가             | 사람 확인 중심                         | `NEEDS_REVISION` |
| `BIAS.LOADED_WORDING`          | 한쪽만 도덕적·긍정적·극단적으로 표현했는가       | 사전 + 사람 확인                       | `NEEDS_REVISION` |
| `FACT.CLAIM_REQUIRES_SOURCE`   | 외부 사실 전제 또는 시의성이 있는가              | Pattern + 출처 계약                    | `HUMAN_REVIEW`   |
| `SAFETY.SENSITIVE_TARGET`      | 민감 집단·실제 인물·사건을 부당하게 대상화하는가 | 안전 사전 + 사람 확인                  | `BLOCK`          |
| `CONTEXT.STANDALONE_CLARITY`   | Feed 단독 노출로 이해 가능한가                   | 길이·대명사 Pattern + 사람 확인        | `NEEDS_REVISION` |
| `CONTEXT.EXCESSIVE_DEPENDENCY` | 외부 링크·영상·부모 문맥 없이는 답할 수 없는가   | Pattern + 사람 확인                    | `BLOCK`          |
| `OPTION.OTHER_NEEDED`          | 답 공간이 열려 있어 기타 선택지가 필요한가       | 원형·Format 규칙                       | `HUMAN_REVIEW`   |
| `OPTION.UNKNOWN_NEEDED`        | 경험·인지 여부를 분리해야 하는가                 | 원형·문맥 규칙                         | `HUMAN_REVIEW`   |
| `DUPLICATE.EXACT`              | 동일 정규화 문구가 존재하는가                    | Content Hash                           | `BLOCK`          |
| `DUPLICATE.SEMANTIC`           | 의미상 가까운 승인 질문이 존재하는가             | Fingerprint/Embedding 후보 + 사람 확인 | `HUMAN_REVIEW`   |
| `PROVENANCE.INCOMPLETE`        | 원형·출처·변환 기록이 빠졌는가                   | 필수 필드 검사                         | `BLOCK`          |

길이 Parity는 후보를 찾는 Heuristic일 뿐 품질의 진실이 아니다. 현재 `3배 또는 24자 초과` 같은
값을 사용하더라도 `rubric_policy_version`에 포함하고 실제 Ops 판정과 성과로 재조정한다.

## 선택지 대칭 검수

선택지 검수는 다음을 각각 기록한다.

- 의미: 상호 구별되며 동시에 같은 답이 될 수 없는가
- 문법: 둘 다 명사구, 행동구 또는 완전한 문장인가
- 길이: 한쪽만 과도한 설명을 갖지 않는가
- 추상화: 행동 대 행동, 대상 대 대상처럼 같은 층위인가
- 강도: `무조건`, `현명한`, `민폐` 같은 평가어가 한쪽에만 붙지 않는가
- 조건: 시간, 금액, 위험과 확률이 양쪽에 동등하게 드러나는가
- 현실성: 둘 중 하나를 실제로 선택할 수 있는가

정확한 글자 수 일치나 기계적인 어미 통일은 목표가 아니다. 의미를 보존하면서 선택에 불필요한
표현 우위를 줄이는 것이 목표다.

## `기타`와 `모르겠다` 정책

v1 `VS`는 정확히 두 Choice만 지원하므로 `기타`나 `모르겠다`를 세 번째 Choice로 추가하지 않는다.
필요성이 감지되면 질문을 고치거나 향후 `PICK` 대상으로 보낸다.

### `기타`가 필요한 조건

- 여러 실제 후보를 분류하고 후보 Coverage 자체가 중요한 질문
- 제시한 Choice가 대표적인 답 공간을 충분히 덮지 못하는 질문
- 공동제작에서 새 후보 제안이 제품 목적에 포함된 질문

이 경우 v1에서는 주요 두 Choice를 유지하고 `다른 답은 댓글로`라는 선택적 안내를 사용할 수 있다.
다만 댓글을 써야만 정상 답변이 가능한 질문은 게시하지 않는다.

### `기타`가 필요하지 않은 조건

- 의도적으로 두 대안을 비교하는 취향·상황·손익 충돌 질문
- 완전한 분류가 목적이 아닌 빠른 강제 선택
- `둘 다`, `아무것도`가 질문의 핵심 변수가 아닌 경우

### `모르겠다/경험 없음`이 필요한 조건

- 경험 여부 자체가 분석에 중요한 변수인 경우
- 특정 상품·게임·콘텐츠 인지도를 함께 측정하는 경우
- 사실 지식이 없으면 거짓 선택을 하게 되는 경우

이 경우 v1 `VS`에서는 `경험한 사람이라면` 같은 대상 조건을 명시하거나 질문을 보류한다.
참여자를 강제로 A/B에 넣어 결과를 왜곡해서는 안 된다.

### `모르겠다`가 필요하지 않은 조건

- 개인 취향, 가상 상황 또는 현재 행동을 묻는 질문
- 정답이 없는 가치·Trade-off 선택
- 문맥을 한 문장 보완하면 누구나 선택할 수 있는 질문

## Provenance와 변환 기록

외부 사례를 참고했거나 후속 질문을 만들 때 다음 필드를 저장한다.

```ts
type QuestionProvenance = {
  archetypeId: "QAR-VS-01" | "QAR-VS-02" | "QAR-VS-03" | "QAR-VS-04" | "QAR-VS-05" | "QAR-VS-06";
  originType:
    | "ORIGINAL"
    | "ARCHETYPE_DERIVED"
    | "EXTERNAL_STRUCTURE_REFERENCE"
    | "FACT_SOURCE_DERIVED"
    | "FOLLOW_UP";
  sourceRequirement: "NOT_REQUIRED_SUBJECTIVE" | "DISCOVERY_SIGNAL_ONLY" | "SOURCE_REQUIRED";
  communitySignalIds: string[];
  factSourceIds: string[];
  parentIssue?: { issueId: string; issueVersion: number; basis: string };
  transformationRecords: Array<{
    fromArchetypeId?: string;
    changedTopic: string;
    changedContext: string;
    changedChoiceStructure: string;
    languageAndVoiceRewrite: string;
    recordedBy: string;
    recordedAt: string;
  }>;
};
```

- 외부 원문 전체를 provenance에 복사하지 않는다.
- Community Signal은 주제 발견 근거이지 사실의 증거가 아니다.
- 사실 전제가 있는 질문은 공식 출처 ID, `asOf`, `reviewAfter`, `expiresAt`을 가진다.
- 외부 고유 캐릭터, 세계관, 유행어, 실제 인물과 이미지의 표현은 변환 대상이 아니다.

## 유사도·중복 검수

중복 판정은 단계적으로 수행한다.

1. `content_hash`: Choice ID까지 포함한 Version 불변성 확인
2. `semantic_fingerprint`: 정규화된 질문·문맥·A/B 문구의 정확 중복 확인
3. `normalized_question_hash`: 조사·공백·문장부호 정규화 후보 탐색
4. `semantic_candidates`: Embedding 또는 모델 기반 Top-K 후보 제시
5. 사람 검토: 주제만 같은지, 실제 선택 구조와 답변 의미까지 같은지 확정

저장 필드:

```ts
type DuplicateReview = {
  algorithmVersion: string;
  normalizedQuestionHash: string;
  semanticFingerprint: string;
  candidates: Array<{
    issueId: string;
    issueVersion: number;
    similarity: number;
    modelVersion?: string;
    matchedDimensions: Array<"QUESTION" | "CONTEXT" | "CHOICES" | "ARCHETYPE">;
  }>;
  decision: "NO_MATCH" | "POSSIBLE_MATCH" | "DUPLICATE";
  reviewedBy?: string;
  reviewedAt?: string;
  note?: string;
};
```

Similarity 숫자는 자동 승인 점수가 아니다. Threshold와 Top-K는 Versioned Policy의 후보 검색
설정이며, `POSSIBLE_MATCH`는 사람 확인 없이 `DUPLICATE`로 승격하지 않는다.

## Versioned Rubric 결과 계약

Member 작성기와 Ops는 다음 공통 입력·출력을 사용한다.

```ts
type AuthoringLinterInput = {
  contractVersion: "authoring_linter_v1";
  content: {
    question: string;
    context: string | null;
    choices: [{ code: "A"; label: string }, { code: "B"; label: string }];
  };
  archetypeId: string;
  provenance: QuestionProvenance;
  interestCardCode: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "RESTRICTED";
};

type AuthoringLinterResult = {
  contractVersion: "authoring_linter_v1";
  rubricPolicyVersion: string;
  inputContentHash: string;
  evaluatedAt: string;
  engineVersions: {
    deterministicRules: string;
    safetyDictionary: string;
    similarity?: string;
    model?: string;
  };
  recommendation: "PASS" | "ADVISORY" | "NEEDS_REVISION" | "HUMAN_REVIEW" | "BLOCK";
  findings: Array<{
    ruleId: string;
    level: "PASS" | "ADVISORY" | "NEEDS_REVISION" | "HUMAN_REVIEW" | "BLOCK";
    path: "question" | "context" | "choices.0.label" | "choices.1.label" | "provenance";
    reasonCode: string;
    messageKey: string;
    evidence: Record<string, string | number | boolean>;
    suggestedRewrite?: string;
  }>;
  duplicateReview: DuplicateReview;
};
```

Rubric 결과는 append-only로 저장하고 `inputContentHash`를 참조한다. 문구가 바뀌면 새 결과를
만들며 이전 결과를 덮어쓰지 않는다. 사람의 승인 결과는 별도 `editorial_decision`으로 저장하고
`linter_result_id`, Actor, Revision과 Note를 참조한다.

## Member 작성기 계약

Member 작성기는 사용자가 고칠 수 있는 순서대로 결과를 보여준다.

1. 입력 중: 길이, 물음표, 동일 Choice, URL처럼 결정적 규칙만 즉시 안내
2. 제출 전: 독립 맥락, 선택지 대칭과 원형 적합성을 요약
3. 제출 시: 서버가 같은 계약으로 다시 평가하고 Client 판정을 신뢰하지 않음
4. `ADVISORY`: 게시를 막지 않고 한 번에 최대 두 개의 구체적인 수정 제안 표시
5. `NEEDS_REVISION`: 문제 Field에 이유와 수정 방향 표시
6. `HUMAN_REVIEW`: 민감한 내부 근거나 유사 후보 원문을 노출하지 않고 검토 필요 안내
7. `BLOCK`: 정책 사유를 사용자 행동 중심의 문구로 설명

Member에게 종합 점수, 내부 Safety 사전, 다른 사용자의 미공개 질문과 AI Confidence를 노출하지
않는다. 자동 Rewrite는 사용자가 명시적으로 적용하고 다시 제출한 경우에만 입력으로 사용한다.

## Ops 승인 체크리스트 계약

Ops는 같은 Finding을 다음 7개 Dimension으로 묶어 확인한다.

- `BINARY_FIT`: 원형과 VS 형식이 실제로 맞는가
- `CHOICE_DISTINCTION`: 두 Choice가 의미상 구별되는가
- `CHOICE_PARITY`: 길이·문법·추상화·강도가 균형적인가
- `STANDALONE_CONTEXT`: Feed 단독 노출로 이해 가능한가
- `BIAS_AND_SAFETY`: 유도 표현, 민감 대상과 부당한 대상화가 없는가
- `FACT_AND_SOURCE`: 사실 전제·시의성·출처와 만료가 적절한가
- `PROVENANCE_AND_DUPLICATE`: 원형·변환 기록과 중복 검수가 완료됐는가

`APPROVED`는 필수 Dimension이 모두 `PASS`이고 차단 Finding이 없을 때만 저장할 수 있다.
`NEEDS_CHANGES`는 실패한 Rule ID와 수정 Note를 요구한다. `REJECTED`는 정책 Reason Code를
요구한다. 운영자가 자동 결과를 Override하면 사유와 Actor를 append-only Revision으로 남긴다.

기존 Ops의 `binaryFit`, `choiceParity`, `duplicateReview`, `sourceReview`는 다음처럼 이전한다.

| 기존 Check        | 공통 Dimension                        |
| ----------------- | ------------------------------------- |
| `binaryFit`       | `BINARY_FIT`, `STANDALONE_CONTEXT`    |
| `choiceParity`    | `CHOICE_DISTINCTION`, `CHOICE_PARITY` |
| `duplicateReview` | `PROVENANCE_AND_DUPLICATE`            |
| `sourceReview`    | `FACT_AND_SOURCE`, `BIAS_AND_SAFETY`  |

## 적용 경계와 순서

### Phase A — Contract와 Shadow

- 규칙 ID, message key와 Rubric Policy Version을 코드 상수로 구현
- 기존 Member validation과 Inventory Heuristic을 공통 Linter Adapter로 연결
- 기존 게시·승인 동작은 바꾸지 않고 결과만 저장·비교
- 현재 Ops 4개 Check와 새 7개 Dimension의 일치·불일치 수집

### Phase B — Member 사전 안내

- 결정적 규칙과 낮은 위험 Advisory부터 노출
- 수정 완료율, 작성 포기율과 잘못된 차단률 측정
- 자동 Rewrite는 Opt-in으로 제한

### Phase C — Ops 공통 체크리스트

- provenance, Duplicate 후보와 Rule Evidence 표시
- Revision·Override 사유와 정책 Version 저장
- 승인된 질문 성과와 신고·이탈 데이터를 Rubric 결과에 사후 연결

### Phase D — 추천 품질 연결

- Linter 통과 여부를 Eligibility Hard Gate로 사용
- 개별 Finding과 사람 판정을 설명 가능한 품질 신호로 제공
- 종합 100점이나 AI Confidence만으로 Trending·추천 자격을 결정하지 않음

## 명시적 비지원 범위

- Linter 결과만으로 사용자 Issue를 영구 삭제하거나 계정을 제재하는 기능
- 임의 가중치의 단일 100점 품질 점수
- 외부 인기 문장, 채널 고유 IP·문체 또는 이미지의 자동 복제
- AI Rewrite의 무검토 자동 게시
- Similarity 숫자만으로 의미 중복을 확정하는 기능
- v1 `VS`에 `기타/모르겠다`를 세 번째 Choice로 추가하는 기능

## 검증 기준

- 여섯 원형이 Rule ID와 예시 없이도 서로 구별된다.
- 같은 입력과 같은 Policy Version은 동일한 결정적 Finding을 만든다.
- Rubric 결과에서 사용한 규칙·사전·모델 Version을 재현할 수 있다.
- Member와 Ops가 같은 Rule ID를 사용하고 서로 다른 자체 규칙을 만들지 않는다.
- 승인에는 7개 Dimension과 사람 Actor·Revision이 기록된다.
- Exact Duplicate는 차단되고 Semantic 후보는 사람 검토로 전달된다.
- `기타/모르겠다` 필요 질문이 v1 A/B 결과를 왜곡하지 않고 보류 또는 재작성된다.

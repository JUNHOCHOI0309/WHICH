# ADR-0004: PICK 3~4지선다 migration boundary

- Status: Accepted for implementation planning; Production disabled
- Date: 2026-08-27
- Task: `WHICH-88`
- Supersedes: none
- Extends: [`ADR-0003`](./0003-issue-format-and-media-policy.md)
- Operations: [`PICK shadow migration runbook`](../../operations/pick-shadow-migration.md)

## Context

WHICH의 Vote는 이미 canonical `choice_id`를 저장하지만, 제품 계약은 텍스트 A/B `VS`에 고정되어
있다. 작성 화면의 입력칸만 늘리면 C/D Vote는 기존 `accepted_a_count`, `accepted_b_count`, 댓글
`choice_snapshot`, 공유 카드와 Web·Mobile 결과 UI에서 표현되지 않는다. 따라서 `PICK`은 작성기
변경이 아니라 데이터·API·Client를 함께 옮기는 additive migration으로 취급한다.

이번 Spike는 Production 동작을 바꾸지 않는다. `PICK` Row나 C/D Choice를 만들지 않고, 후속
Vertical Slice가 따를 데이터 소유권, 호환 계약, UI 규칙과 rollout gate를 확정한다.

## Decision

### 1. 제품 형식과 작성기 규칙

- `VS`: 정확히 2개 Choice. 기존 WHICH 기본 형식이다.
- `PICK`: 3~4개 Choice 중 하나를 고르는 형식이다.
- 작성기는 형식 선택을 먼저 묻지 않는다. Choice 수가 2개면 `VS`, 3~4개면 `PICK`으로 서버가
  결정한다.
- 초기 Draft에는 A/B 두 항목이 항상 존재하며 삭제할 수 없다.
- A/B 아래의 `+ 항목 추가`를 누르면 C, 다음에는 D가 추가된다. 4개가 되면 추가 버튼은 숨기거나
  비활성화한다.
- 추가된 C/D에만 제거 버튼을 제공한다. C를 제거하고 D가 남으면 화면 순서와 code를 다시
  A/B/C로 정규화한다.
- 제거 버튼의 시각 표시는 `−`를 사용할 수 있지만 접근 가능한 이름은 `C 선택지 삭제`처럼
  구체적으로 제공한다. 버튼의 최소 터치 영역은 44px이다.
- 같은 Label, 공백 Label, 50자를 넘는 Label은 제출할 수 없다. 최소 2개·최대 4개 규칙은 Client와
  API 양쪽에서 검증한다.
- Draft는 배열과 안정적인 client key로 관리한다. 배열 index 자체를 React key나 분석 identity로
  사용하지 않는다.

```text
질문

[A] 첫 번째 선택                         (고정)
[B] 두 번째 선택                         (고정)
[C] 세 번째 선택                    [−]  (추가 항목)

[              + 항목 추가               ]
```

### 2. A/B 고정 의존 지점 inventory

| 영역         | 현재 고정 지점                                        | PICK 전환                                                                   |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| DB Choice    | `choice_code` enum이 A/B, `format_mode` check가 VS    | enum에 C/D를 additive하게 예약하고 `PICK` 허용. identity는 계속 `choice_id` |
| DB aggregate | `vote_aggregates.accepted_a_count/accepted_b_count`   | Choice별 child aggregate 추가, 기존 열은 VS 호환용 유지                     |
| DB snapshot  | `result_snapshots.accepted_a_count/accepted_b_count`  | Snapshot별 Choice count child row 추가                                      |
| Vote         | Vote가 이미 `choice_id` FK를 사용                     | 구조 재사용. generic aggregate dual-write만 추가                            |
| 댓글         | `comments.choice_snapshot`이 A/B enum                 | `choice_id`와 label snapshot을 추가하고 code는 VS 호환용 유지               |
| 공유         | `share_cards.shared_choice_code`가 A/B enum           | `shared_choice_id` 추가, generic snapshot으로 카드 생성                     |
| Issue API    | Choice code A/B, 정확히 2개, `acceptedA/B`            | Choice 2~4개와 `tally.choices[]` additive 계약                              |
| 작성 API     | `choiceA`, `choiceB`                                  | `choices[]` 추가. legacy body는 VS에 한해 계속 수용                         |
| Issue Pack   | A/B tuple 및 parity lint                              | format별 cardinality validator와 PICK 중복·대칭 lint                        |
| Web          | `BalanceResultBar`, A/B comment filter, split preview | Choice list, per-choice bar, 동적 댓글 filter, 가변 preview                 |
| Mobile       | Feed/Detail에서 A/B를 직접 찾음                       | 2~4 Choice list와 결과 list. 고정 action bar가 내용을 가리지 않게 scroll    |
| 공유 이미지  | A/B split layout                                      | 3~4행 결과 layout과 동적 image height                                       |
| 분석         | canonical Choice와 shown position은 이미 0~3 지원     | Client가 모든 Choice의 `choice_id`와 실제 position을 전송                   |
| 추천/논쟁    | `acceptedA/B`와 50:50 balance                         | top-two gap을 주 지표, normalized entropy를 보조 지표로 사용                |
| 운영 검수    | `binaryFit`, `choiceParity`                           | format fit, Choice 중복, 후보 집합 완결성과 표현 대칭으로 일반화            |

주요 구현 위치는 다음과 같다.

- DB: `database/schema/enums.ts`, `issues.ts`, `results.ts`, `comments.ts`, `shares.ts`
- API: `modules/issues`, `voting`, `comments`, `shares`, `issue-publication`, `identity`
- Web: `lib/contracts.ts`, `issue-creator-experience.tsx`, `feed-experience.tsx`,
  `issue-experience.tsx`, `balance-result-bar.tsx`, 공유 이미지 Route
- Mobile: `src/contracts.ts`, `app/index.tsx`, `app/issues/[issueId].tsx`,
  `balance-result-bar.tsx`
- Quality/Analytics: `modules/recommendations`, `modules/analytics`, `core-analytics.md`

### 3. Generic aggregate와 snapshot

기존 `vote_aggregates`는 요청 수, 무효화 수, integrity 상태와 result version의 Issue-level control
row로 유지한다. Choice별 accepted count는 다음 child table이 소유한다.

```text
vote_choice_aggregates
  issue_id
  issue_version
  choice_id
  accepted_count
  PRIMARY KEY (issue_id, issue_version, choice_id)

result_snapshot_choices
  tally_snapshot_id
  choice_id
  accepted_count
  PRIMARY KEY (tally_snapshot_id, choice_id)
```

두 table 모두 Choice의 `(issue_id, issue_version, choice_id)` 소유권을 FK로 검증한다. 기존 A/B 열은
VS 구형 Client와 rollback을 위해 바로 삭제하지 않는다.

새 공개 계약은 다음을 기준으로 한다.

```ts
type IssueTally = {
  resultVersion: number;
  displayedTotal: number;
  integrityState: IntegrityState;
  choices: Array<{
    choiceId: string;
    acceptedCount: number;
  }>;
  acceptedA?: number; // VS compatibility only
  acceptedB?: number; // VS compatibility only
};
```

`displayedTotal`은 항상 `sum(tally.choices[].acceptedCount)`와 같아야 한다. Label, code와 화면 위치는
Issue Version의 Choice 응답에서 얻고 tally에 복제하지 않는다.

### 4. Choice code와 identity

- 영구 identity는 `choice_id`다.
- A/B/C/D code는 Version 안에서 사람이 읽는 안정적인 short code이며 화면 위치가 아니다.
- 첫 migration에서는 PostgreSQL enum에 C/D를 추가한다. enum value 추가는 rollback하지 않아도
  기존 VS 동작에 영향을 주지 않는 additive 변경이다.
- 댓글과 공유의 canonical 참조를 `choice_id`로 옮긴 뒤 code 기반 FK와 snapshot은 deprecated
  compatibility field가 된다. 실제 제거는 모든 v1 read가 종료된 별도 migration에서만 수행한다.
- `display_position`은 0~3을 저장하고 unique `(issue_id, issue_version, display_position)`으로
  보호한다. presentation 실험은 canonical position을 바꾸지 않고 analytics `shown_position`만
  바꾼다.

### 5. API 호환과 Client capability

- 기존 `/v1` VS 응답에는 `acceptedA`, `acceptedB`를 계속 채운다.
- 같은 응답에 `formatMode`, `displayPosition`, `tally.choices[]`를 additive하게 추가한다.
- PICK을 지원하지 않는 Client에는 PICK Issue를 feed/detail에서 반환하지 않는다.
- PICK 지원 Client는 명시적인 capability(`pick-v1`)를 보낸다. 서버 flag와 capability가 모두 켜진
  경우에만 PICK을 반환한다.
- 작성 body는 legacy `{ choiceA, choiceB }`와 신규 `{ choices: [{ label }, ...] }`를 migration
  기간 동안 모두 받는다. 둘을 동시에 보내면 400으로 거절한다.
- 서버는 Choice 수로 format을 결정하며 Client가 `formatMode`를 위조해 cardinality 검증을 우회할
  수 없게 한다.

### 6. 댓글과 공유

- 댓글 작성 자격은 기존처럼 해당 Issue Version의 유효 Vote다. 댓글에는 그 Vote의 `choice_id`와
  당시 Label snapshot을 저장한다.
- 댓글 filter는 `ALL | choiceId`가 canonical 계약이다. A/B side query는 VS compatibility adapter로
  남긴다.
- 대표 댓글 응답은 `{ choice, items[] }[]` 배열로 일반화한다. PICK에서 비어 있는 Choice도 안정된
  순서로 반환한다.
- 공유 요청은 `sharedChoiceId`를 사용한다. VS 요청의 `sharedChoiceCode`는 서버가 Choice ID로
  변환한다.
- 공유 카드 결과는 3~4개의 수평 bar list로 표현하며 한쪽을 추천하는 색·크기 편향을 만들지 않는다.

### 7. Web·Mobile 결과 UI

- 투표 전: 2~4개의 동일 높이 Choice row를 세로로 보여준다. PICK을 split A/B bar로 표현하지
  않는다.
- 투표 후: 각 Choice의 Label, count, percentage와 bar를 동일 구조로 표시한다. 내 선택은 check와
  `내 선택` text로 별도 표시한다.
- 정렬은 작성자가 정한 canonical position을 유지한다. 득표순 재정렬로 선택 위치가 움직이지
  않는다.
- 3~4개 카드의 기본 높이는 내용에 따라 늘리고, Feed 밀도를 위해 상세 댓글은 접는다. 작은 화면의
  작성 모달은 body가 scroll되고 제출 bar는 safe area 위에 고정한다.
- 결과 percentage 합은 largest-remainder 방식으로 100%를 맞춘다. 0표는 모든 Choice를 0%로
  표시한다.
- `radiogroup`, Choice별 accessible name, add/remove live announcement, keyboard focus 복원과
  `prefers-reduced-motion`을 지원한다.

### 8. 다지선다 논쟁 지표

accepted count를 내림차순으로 `c1`, `c2`, 전체를 `T`, Choice 수를 `n`이라 한다.

```text
top_two_gap_ratio = (c1 - c2) / T
normalized_entropy = -sum(pi * ln(pi)) / ln(n), pi = ci / T
```

- `top_two_gap_ratio`가 작을수록 1·2위가 접전이다. 이것이 PICK의 primary closeness signal이다.
- `normalized_entropy`는 표가 전체 후보에 얼마나 퍼졌는지 보는 0~1 보조 지표다.
- T가 0이면 두 값은 0이 아니라 `null`이다.
- 논쟁 후보는 최소 유효 Vote, 전환율, 댓글 품질, 낮은 신고·skip 조건을 먼저 통과해야 한다.
  gap이나 entropy만으로 노출하지 않는다.
- 실행 가능한 기준 구현은 `modules/voting/choice-distribution.ts`와 단위 테스트에 둔다. 이번
  Spike에서는 Production ranker에 연결하지 않는다.

### 9. Migration 순서

1. **Observe**: 현재 VS cardinality, aggregate와 Vote 원장의 정합성을 측정한다.
2. **Add schema**: C/D enum, PICK format, display position, generic aggregate/snapshot과 canonical
   comment/share FK를 additive하게 추가한다.
3. **Backfill**: accepted Vote 원장에서 generic current aggregate를 만들고 기존 snapshot의 A/B를
   snapshot Choice row로 변환한다. 댓글·공유 Choice ID도 backfill한다.
4. **Shadow read**: VS 결과를 legacy와 generic 양쪽에서 읽어 비교하되 사용자 응답은 legacy다.
5. **Dual write**: VS Vote transaction에서 legacy와 generic aggregate/snapshot을 함께 갱신한다.
6. **Generic read**: 일치율이 gate를 통과하면 VS 응답을 generic에서 만들고 legacy 필드도 파생한다.
7. **Internal PICK**: 운영/테스트 subject에게만 3~4 Choice 작성·투표를 연다.
8. **Limited PICK**: Web, Mobile 각각 capability gate를 통과한 Client에 제한 노출한다.
9. **Cleanup**: 충분한 관찰 기간 뒤 legacy writer 제거를 별도 Task로 결정한다.

### 10. Feature flag와 rollback

권장 server modes:

- `ISSUE_PICK_WRITE_MODE=OFF|INTERNAL|LIVE`
- `ISSUE_TALLY_READ_MODE=LEGACY|SHADOW|GENERIC`
- `ISSUE_TALLY_DUAL_WRITE=false|true`

기본값은 `OFF`, `LEGACY`, `false`다. Client의 public env만으로 PICK을 열 수 없고 server eligibility가
최종 권한을 가진다.

Rollback은 flag를 `OFF`, `LEGACY`, `false`로 되돌리고 PICK을 feed에서 제외한다. Schema와 이미
저장된 PICK Vote는 삭제하지 않는다. C/D enum도 제거하지 않는다. Generic child table은 보존하여
복구 후 재검증할 수 있게 한다. 운영 중 생성된 PICK을 VS로 강제 변환하지 않는다.

## Consequences

- 기본 A/B 작성 경험은 그대로 유지되며 사용자가 필요할 때만 C/D를 추가한다.
- Vote의 canonical identity를 재사용하여 원장 migration 위험을 줄인다.
- 일정 기간 두 aggregate와 두 API 표현을 유지하므로 쓰기·검증 복잡도가 증가한다.
- PICK을 이해하지 못하는 구형 Client에 3~4 Choice를 보내지 않아 부분 UI나 유실을 막는다.
- Production 노출은 이 ADR이 아니라 후속 Vertical Slice와 QA Task에서 승인한다.

## Follow-up boundary

후속 Vertical Slice의 최소 완료 범위는 schema migration, dual-write/shadow verifier, 신규 작성
배열 UI, Web 투표·결과·댓글·공유, Mobile 동등성, feature flag와 rollback rehearsal이다. 어느 한
Surface라도 generic Choice를 표현하지 못하면 PICK public eligibility를 열지 않는다.

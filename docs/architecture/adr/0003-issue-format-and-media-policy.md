# ADR-0003: Issue format and media policy

- Status: Accepted
- Date: 2026-08-26
- Task: `WHICH-81`
- Related: [`issue-format-image-and-poll-expansion-roadmap.md`](../../product/issue-format-image-and-poll-expansion-roadmap.md)

## Context

현재 WHICH는 `issues -> issue_versions -> issue_choices` 구조를 사용하지만 실제 제품 계약은
A/B 텍스트 투표에 고정되어 있다. Choice code, 집계, 댓글 선택 Snapshot, 공유 카드와 Web·Mobile
결과 UI가 모두 A/B를 전제로 한다.

이미지 A/B는 이 계약을 유지한 채 확장할 수 있지만, 다지선다를 같은 변경으로 추가하면 Vote,
집계, API, 댓글, 공유와 분석을 동시에 바꾸게 된다. 또한 Issue의 lifecycle, visibility,
participation과 feed eligibility가 이미 분리되어 있으므로 미디어 처리 상태를 Issue 상태에 섞으면
서로 다른 의미의 상태가 충돌한다.

## Decision

### 1. 제품 형식 경계

| Format       | 의미                            |   Choice 수 | v1 상태                     |
| ------------ | ------------------------------- | ----------: | --------------------------- |
| `VS`         | 두 선택지의 빠른 비교·선택      |    정확히 2 | 지원                        |
| `PICK`       | 실제 복수 후보 중 단일 선택     |         3~4 | Migration Spike 전 비지원   |
| `TOURNAMENT` | 여러 후보를 A/B Round로 축소    |   Round별 2 | 별도 Series 도메인 연구     |
| `PREDICTION` | 마감 후 실제 결과로 적중을 확정 | 형식별 정의 | 별도 Resolution 도메인 연구 |

`TOURNAMENT`는 5개 이상 Choice를 한 Issue에 넣는 형식이 아니다. Series, Round, 진출 Choice와
종료 규칙을 가진다. `PREDICTION`은 `closesAt`, resolution 상태, resolved Choice, `VOID`와 적중
기록이 필요하며 상시 취향 Issue와 같은 lifecycle로 취급하지 않는다.

v1의 첫 지원 범위는 다음으로 고정한다.

```text
format_mode: VS
media_mode: TEXT_ONLY | OPTION_IMAGES
author: OPERATOR only when media_mode = OPTION_IMAGES
choices: exactly two, text label required
```

### 2. Format과 media mode는 versioned content다

`format_mode`와 `media_mode`는 `issues`가 아니라 `issue_versions`에 속한다. 질문, 문맥, Choice와
미디어 구성이 바뀌면 새 Issue Version을 만든다. 이미 Vote가 시작되어 잠긴 Version의 형식,
Choice identity와 미디어 연결은 제자리에서 수정하지 않는다.

예약한 media mode의 의미는 다음과 같다.

- `TEXT_ONLY`: 텍스트만으로 질문과 모든 Choice를 이해할 수 있다.
- `OPTION_IMAGES`: 각 Choice에 정확히 한 개의 승인된 이미지가 연결되며 텍스트 Label은 필수다.
- `CONTEXT_IMAGE`: 질문 전체를 보조하는 이미지다. v1에서는 비지원하며 향후 별도 결정한다.

### 3. 기존 Issue 상태축은 유지한다

미디어가 Issue의 lifecycle, visibility, participation, result visibility 또는 feed eligibility를
대체하지 않는다. 미디어는 다음 독립 상태축을 가진다.

| Axis               | 상태                                             | 책임                   |
| ------------------ | ------------------------------------------------ | ---------------------- |
| `processing_state` | `PENDING`, `PROCESSING`, `READY`, `FAILED`       | 검사·변환 성공 여부    |
| `moderation_state` | `PENDING`, `APPROVED`, `REJECTED`, `REVOKED`     | 게시 가능 판정         |
| `storage_state`    | `STAGED`, `PUBLISHED`, `QUARANTINED`, `PURGED`   | Object 접근과 수명주기 |
| `rights_state`     | `ASSERTED`, `CHALLENGED`, `CLEARED`, `WITHDRAWN` | 출처·권리 상태         |

Issue 공개 가능 여부는 기존 Issue 상태와 연결된 모든 Media Asset이 `READY`, `APPROVED`,
`PUBLISHED`이고 권리상 게시 가능할 때 계산한다. 이 계산 결과를 또 하나의 Issue status로
저장하지 않는다.

### 4. Choice identity와 화면 위치를 분리한다

- Vote, 댓글, 공유와 분석의 canonical identity는 `choice_id`다.
- `A`와 `B`는 v1 호환을 위한 code이며 영구적인 화면 좌우 위치가 아니다.
- 화면 위치는 Version별 `display_position` 또는 응답의 presentation metadata로 표현한다.
- 위치를 섞는 실험은 `choice_id`, shown position과 presentation policy version을 노출 이벤트에
  함께 기록한다.
- `OPTION_IMAGES` 연결은 `(issue_id, issue_version, choice_id)`를 사용하며 alt text와 crop 정보를
  별도 보관한다.

따라서 Choice를 좌우로 바꿔 보여도 기존 Vote의 의미가 바뀌지 않는다.

### 5. 이미지 정책

v1 `OPTION_IMAGES`는 운영자만 작성할 수 있다. 외부 URL, GIF, 영상, 선택지당 여러 이미지와
일반 사용자 업로드는 허용하지 않는다. JPEG, PNG 또는 WebP 입력을 서버에서 검사하고 방향
보정, EXIF·GPS 제거와 WebP 재인코딩을 수행한다.

두 Choice 이미지는 비율, crop, 해상도와 시각적 강조를 가능한 한 대칭으로 유지한다. 이미지가
없거나 로드되지 않아도 Label과 alt text만으로 질문을 이해하고 Vote할 수 있어야 한다.

Staging Object는 공개하지 않는다. 승인된 게시용 변형만 Published namespace에서 제공하며,
반려·고아·권리 철회 자산은 보존 정책에 따라 Quarantine 또는 Purge한다.

### 6. 기존 A/B 호환 경계

첫 이미지 A/B Migration은 additive하게 진행한다.

1. 기존 Row는 `format_mode = VS`, `media_mode = TEXT_ONLY`로 해석한다.
2. 기존 `choice_code` enum과 A/B Choice 제약을 유지한다.
3. 기존 API의 `acceptedA`, `acceptedB`, 댓글 `choice_snapshot`, 공유 `sharedChoiceCode`를 유지한다.
4. 미디어 필드는 확장 응답에 optional로 추가하며 구형 Client는 이를 무시할 수 있어야 한다.
5. 이미지가 실패하거나 Feature Flag가 꺼지면 같은 Choice Label의 `TEXT_ONLY` 카드로 표시한다.
6. 기존 Issue Pack과 Member 작성기는 변경 없이 텍스트 `VS`를 생성한다.

이미 게시된 Version에서 미디어만 제거해야 할 때는 Issue Vote를 삭제하지 않는다. 자산 접근을
차단하고 텍스트 fallback을 사용한다. 질문 또는 Choice 의미가 바뀌면 새 Version 또는 Successor
Issue를 만든다.

### 7. Rollback

- `OPTION_IMAGES` 노출은 Server-side Feature Flag로 중단할 수 있다.
- Rollback은 미디어 응답과 UI만 비활성화하며 Issue, Choice와 Vote Row를 되돌리지 않는다.
- 모든 이미지 Issue는 Label 필수이므로 즉시 `TEXT_ONLY`로 안전하게 저하된다.
- Migration은 기존 Column과 enum을 삭제하거나 이름을 바꾸지 않는다.
- 신규 Client가 배포된 뒤에도 구형 API 응답 계약을 유지한다.

### 8. 명시적 비지원 범위

다음 항목은 이 ADR로 승인되지 않는다.

- 일반 사용자 이미지 업로드와 Member 상태 기반 자동 권한 부여
- `PICK` 3~4지선다 및 generic per-choice aggregate
- `TOURNAMENT`, Series와 Round 생성
- `PREDICTION` 마감·결과 확정·적중 기록
- `CONTEXT_IMAGE`, GIF, 영상, 외부 이미지 URL과 선택지당 복수 이미지
- 얼굴·외모 비교, 권리 확인 없는 타인 이미지와 외부 플랫폼 콘텐츠 재사용

Member의 이미지 작성 권한은 `member_status`에 `TRUSTED`나 `CREATOR`를 추가하지 않고 별도
Capability 또는 Entitlement로 설계한다.

## Migration boundaries

### Boundary A — v1 operator image VS

Additive format/media metadata, Media Asset과 Choice Media Link만 추가한다. A/B Vote, aggregate,
댓글과 공유 계약은 변경하지 않는다.

### Boundary B — PICK spike

별도 Task에서 `choice_code` 제거 전략, generic per-choice tally, result snapshot, 댓글·공유·분석과
Web·Mobile 가변 Choice 계약을 함께 검증한다. A/B backfill 결과가 기존 aggregate와 일치하고
양방향 rollback이 입증되기 전에는 Production write를 열지 않는다.

### Boundary C — series and resolved formats

`TOURNAMENT`와 `PREDICTION`은 Issue 선택지 수 확장이 아니라 상위 진행 상태를 가진 도메인으로
연구한다. Boundary B와 묶어 구현하지 않는다.

## Consequences

- 운영자 이미지 A/B를 기존 Vote 무결성 계약을 건드리지 않고 도입할 수 있다.
- 이미지의 처리·검수·권리·저장 상태를 각각 추적해야 하므로 데이터 모델은 더 명시적이 된다.
- `PICK`은 작은 UI 변경이 아니라 횡단 Migration으로 남는다.
- 텍스트 fallback이 필수이므로 이미지 제작 실패가 Issue 공급을 막지 않는다.
- Position bias를 측정하고 완화할 수 있지만 노출 이벤트 계약 확장이 필요하다.

## Revisit triggers

- 운영자 이미지 A/B가 텍스트 대비 유의미한 참여 품질 개선을 보인다.
- 실제 사용자 질문에서 A/B로 표현할 수 없는 3~4개 후보 수요가 반복 확인된다.
- 이미지 검수 Queue와 권리 요청 SLA가 신뢰 사용자 Pilot을 감당할 수 있다.
- Tournament 또는 Prediction이 별도 재방문 성과를 만들 수 있다는 데이터가 생긴다.

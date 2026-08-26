# Future format v2 readiness runbook

WHICH-90은 Tournament와 Prediction을 v2 후보로 평가하는 절차를 정의한다. 현재 Production에는
두 형식의 table, Route, scheduler와 UI가 없으며 flag 기본값은 `OFF`다.

## 1. 공통 선행 Gate

- Public v0 안정 운영 30일 이상
- 최근 30일 Sev-1 안전·무결성 사건 0건
- PICK 도입 여부 결정 완료
- 10명 이상 비공개 prototype 연구와 명시적 수요 근거
- 제품 문구 검토 완료
- 첫 Pilot Vertical 정책·권리·신고 SLA 승인
- Tournament와 Prediction 중 하나만 Vertical Slice 후보로 선정

조건이 부족하면 `INSUFFICIENT_EVIDENCE`로 기록한다. 이를 일정상의 `GO`로 해석하지 않는다.

## 2. Tournament Dry Run

최소 3개의 전체 Series를 fixture로 실행한다. 8강, 동률, 최소 Vote 미달과 취소 시나리오를 포함한다.

검증 항목:

1. Entry와 seed를 잠근 뒤 Round 1을 정확히 한 번 생성
2. 열린 Match에서 다음 Round가 생성되지 않음
3. 잠기지 않은 Result Snapshot에서 진출하지 않음
4. 최소 Vote 미달과 동률에서 임의 승자가 생기지 않음
5. 모든 Match가 진출한 뒤 bracket position 순서로 다음 Round 생성
6. 같은 generation key 재실행이 no-op이며 중복 Issue가 없음
7. Final 승자와 source Match·Choice를 추적 가능
8. Series VOID/CANCELLED 시 과거 Vote와 event가 보존됨

상태 전이 실패나 replay mismatch가 한 건이라도 있으면 `NO_GO`다.

## 3. Prediction Resolution Drill

공식 결과, 일정 연기, 취소, 무승부, 잘못된 source와 결과 정정 fixture를 최소 30개 실행한다.

검증 항목:

1. `closes_at` 이후 Vote가 차단됨
2. close job 재실행이 idempotent함
3. 정확히 한 resolved Choice 또는 VOID reason만 허용됨
4. source reference가 없는 Resolution이 거절됨
5. 다른 Prediction의 Choice가 거절됨
6. 정정이 revision을 추가하고 기존 Resolution을 보존함
7. accepted Vote에서 HIT/MISS/VOID를 재계산함
8. 해결 예정 시간 내 모든 fixture가 `RESOLVED` 또는 `VOID`가 됨

감사 실패 또는 기한을 넘긴 미해결 fixture가 한 건이라도 있으면 `NO_GO`다.

## 4. 제품·정책 Review

- 실제 다음 Round에 반영되지 않는 의견 조사를 공동 결정으로 표현하지 않는다.
- Prediction의 다수 Choice를 공식 정답처럼 표현하지 않는다.
- 정치·시사와 실제 인물은 첫 Pilot 후보에서 제외한다.
- 스포츠는 공식 결과 source와 데이터·상표 권리를 문서화한다.
- 팬덤 IP는 권리 근거가 없는 이미지·로고·영상과 후보 자산을 사용하지 않는다.
- 금융·도박성 보상은 별도 법률 결정 전까지 연결하지 않는다.

문구나 Vertical 정책이 승인되지 않으면 `NO_GO`다.

## 5. 판정 기록

`evaluateFutureFormatV2Gate`에 근거값을 넣고 원시 evidence와 판정 버전을 함께 저장한다.

- `INSUFFICIENT_EVIDENCE`: 연구만 계속하고 schema와 사용자 Surface를 만들지 않음
- `GO`: 선택한 형식 하나의 내부 Vertical Slice Task 생성 가능
- `NO_GO`: 원인 해결 전 구현·노출 중단

GO 이후에도 별도 Gate가 필요하다.

- additive migration과 rollback rehearsal
- scheduler·source adapter의 장애 격리
- Ops 상태·Resolution 수정·VOID 화면
- Web·Mobile 최소 지원 버전과 capability
- internal QA 후 제한 Pilot

## 6. Rollback rehearsal

1. 형식별 server mode를 `OFF`로 전환
2. 신규 Series Round 생성 또는 Prediction 제출 중단
3. 생성된 Issue, Vote, Snapshot, Resolution revision과 event 보존
4. 열린 Tournament는 현재 Round 종료 후 중단하거나 Series VOID 근거 기록
5. 열린 Prediction은 공식 결과로 해결하거나 공개된 정책에 따라 VOID
6. 상시 취향 VS Feed, Vote, 댓글과 공유가 계속 동작하는지 확인

Rollback은 원장 삭제나 과거 결과 재작성으로 수행하지 않는다.

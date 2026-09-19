# Radar 주제·사건 정규화

Radar R08은 수집된 문자열을 기존 Topic/Event에 연결할 때 동명이인과 서로 다른 사건을 자동으로 합치지 않기 위한 로컬 구현이다. 이 단계는 후보 판별과 감사 이력만 제공하며 운영 수집·자동 병합·자동 게시는 활성화하지 않는다.

## 불변 원칙

- **Topic과 Event는 다르다.** Topic은 지속되는 대상·개념이고 Event는 특정 시각의 사건이다.
- 문자열이 같다는 이유만으로 합치지 않는다. 퍼지 검색, 임베딩, LLM 유사도는 자동 확정 근거가 아니다.
- 별칭은 `표준화 문자열 + 언어 + 출처 범위 + 유효 시각 + 검증 상태`로 판별한다.
- 같은 주제와 제목이어도 사건 날짜가 다르면 별도 Event다.
- 교차 출처 사건의 시각을 모르면 자동 병합하지 않는다.
- 병합·분리·취소는 삭제하거나 덮어쓰지 않고 append-only 이력으로 보존한다.

## 문자열과 언어 표준화

- Unicode NFKC, 소문자화, 연속 공백 축약을 적용한다.
- 구두점은 의미가 있을 수 있으므로 임의 삭제하지 않는다.
- 탭과 줄바꿈은 공백으로 축약한다.
- bidi override, zero-width 문자 및 비표시 제어 문자는 거부한다.
- 언어 코드는 `Intl.getCanonicalLocales`의 BCP 47 표준형으로 저장한다.
- 같은 시각을 다른 offset으로 표현한 값은 UTC instant로 정규화해 동일한 idempotency key를 만든다.

## Topic 판별

1. `VERIFIED`이고 별칭 문자열, 언어, 유효 구간이 일치하는 행만 후보로 사용한다.
2. 현재 출처에 한정된 별칭이 있으면 global 별칭보다 우선한다.
3. 유일한 Topic이면 `MATCHED`, 둘 이상이면 `AMBIGUOUS`, 없으면 `UNRESOLVED`다.
4. `CANDIDATE`와 `REJECTED` 별칭은 자동 연결에 사용하지 않는다.

따라서 같은 `Main`, `Apple`, `애플` 문자열이 여러 실체를 가리키면 강제로 합치지 않는다.

## Event 판별

1. 제공자의 `(source, sourceItemId)`가 이미 등록돼 있으면 해당 Event를 사용한다.
2. 교차 출처에서는 정규화 제목, 언어, Topic 집합과 알려진 시각이 모두 일치해야 한다.
3. 양쪽이 `EXACT`이면 instant가 같아야 한다. 어느 한쪽이 `DAY`이면 UTC 날짜가 같아야 한다.
4. 시각이 `UNKNOWN`인 교차 출처 Event는 `UNRESOLVED`다.
5. 동일한 근거가 여러 Event를 가리키면 `AMBIGUOUS`다.

## 감사 이력과 복구

`radar_resolution_actions`는 다음 결정을 순서대로 보존한다.

- `MERGE`: subject를 단일 target으로 병합
- `SPLIT`: subject를 둘 이상의 target으로 분리
- `REVERT`: 현재 적용 중인 MERGE/SPLIT 결정을 취소

취소는 기존 행을 지우지 않는다. 원 결정과 REVERT 행이 모두 남아 잘못된 병합의 원인, 수행자, resolver 버전과 복구 과정을 추적할 수 있다. 동일 subject의 결정은 PostgreSQL row lock으로 직렬화하며, 이미 퇴역한 subject 또는 target에는 새 결정을 기록하지 않는다. 다형적 Topic/Event ID의 외래 키는 DB 하나로 표현할 수 없으므로 repository가 해당 타입의 실제 행을 lock·검증한 뒤 쓰고, action 형태 자체는 DB check constraint로도 방어한다.

## 저장 테이블

- `radar_topic_aliases`: 검증 상태, 언어, 출처, 유효 구간을 포함한 Topic 별칭
- `radar_event_source_references`: 제공자 항목과 Event의 유일한 연결
- `radar_resolution_actions`: MERGE/SPLIT/REVERT append-only 이력

Migration은 `0069_radar_entity_resolution.sql`이다.

## 검증

```powershell
pnpm radar:test:resolution
pnpm radar:test:db
pnpm --filter @which/api typecheck
```

고정 fixture는 동명이인, 출처 전용 별칭, 별칭 만료, 언어 경계, 같은 Topic의 서로 다른 날짜 Event, 시각 미상 교차 출처, 잘못된 병합 취소를 포함한다. DB 통합 검증은 idempotent replay, 제공자 항목 충돌, append-only 복구, 분리 이력, 동시 결정 직렬화와 schema constraint를 포함한다.

## 이 단계의 제외 범위

- fuzzy/embedding/LLM 기반 자동 병합
- 운영 데이터 migration 및 backfill
- 수집 파이프라인에서의 자동 호출
- 관리자 병합 UI
- 게시 질문의 자동 수정 또는 자동 공개

후속 단계는 이 판별 결과에서 `MATCHED`만 안전하게 사용하고, `AMBIGUOUS`와 `UNRESOLVED`를 검토 후보로 보낸다.

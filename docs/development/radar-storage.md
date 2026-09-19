# Radar R03 — PostgreSQL 저장소 (WHICH-149)

로컬 구현 / 운영 미반영. R01의 도메인 계약과 R02의 보존 상한을 저장 모델로 옮긴다. 수집 권한 승인, 자동 수집, AI 처리, 공개 API나 화면은 추가하지 않는다.

## 구조

| 테이블                      | 역할 / 무결성                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| radar_sources               | 4개 소스 식별자. FK 대상일 뿐 활성화/승인 설정이 아님                                     |
| radar_topics                | 지속되는 주제. UUID 식별, 같은 이름으로 자동 병합하지 않음                                |
| radar_events                | 사건 제목과 발생시각/정밀도. UNKNOWN ↔ null 강제                                          |
| radar_event_topics          | 사건-주제 다대다. 복합 PK로 중복 연결 금지                                                |
| radar_evidence              | 사건별 출처/주장/게시·관측 시각/상태/만료. Event·Source FK                                |
| radar_observations          | 정규화 관측값. observationKey unique, 시간대 있는 관측창/수집시각, 비교 집단, null/0 구분 |
| radar_observation_revisions | 관측값 원본/정정 payload 이력. observationId+contentHash PK                               |
| radar_event_observations    | 사건-관측 다대다. 미존재 관측 연결 불가                                                   |
| radar_issue_links           | 기존 질문 버전 연결. issue_versions(issue_id, issue_version) 복합 FK                      |

`0067_radar_storage.sql`은 Radar 테이블·인덱스·FK와 소스 코드 4개만 추가한다. 기존 Issue/Vote 테이블 변경·갱신·삭제는 없다. 관측창, source+sampledAt, source+item, 발생시각, 근거 관측시각, expiresAt 인덱스를 둔다. Drizzle schema/snapshot/journal을 함께 관리한다.

## 저장 API

`createRadarRepository(database)`는 서버 내부 저장소이며 HTTP 라우트가 아니다.

- `saveObservation(input, {fetchedAt, expiresAt}, expectedContentHash?)`: R01 정규화 후 unique key로 insert, 행 잠금으로 직렬화. 최초 payload와 정정 payload를 같은 트랜잭션에서 보존한다.
- 같은 입력의 재시도는 같은 ID이며 새 revision/보존 연장을 만들지 않는다. 값이 다르면 현재 contentHash와 일치하는 expectedContentHash를 요구한다. 늦은 재시도가 최신 값을 덮거나 동시에 들어온 정정이 유실되지 않는다.
- 정정 시에도 최초 fetchedAt은 유지하고 expiresAt을 늘리지 않는다. 새 logical sample은 R01 규칙에 따라 새 관측이다.
- `saveEventBundle`: 주제·사건·근거·관측/질문 연결을 한 트랜잭션으로 저장한다. FK/충돌 오류 시 해당 묶음 전체 rollback. 재실행 중복 없음. 기존 ID의 제목/근거 내용을 몰래 덮지 않고 충돌을 보고한다. 연결은 추가만 하며 제거/편집은 후속 명시적 워크플로가 필요하다.
- `findUnexpiredObservation(id, now)`: fetchedAt ≤ now < expiresAt 범위만 반환한다. 반환 가능하다는 것이 권한 확인을 대신하지 않는다.

정정 이력은 원본 payload 자체이며 증거의 진실성 판정 결과가 아니다. payload 내 출처 문자열은 신뢰하지 않는 데이터다. 원문 URL을 이 모듈에서 요청하거나 본문을 복제하지 않는다.

## 보존·권한 경계

- 보존 기간은 명시적이며 0초 초과·24시간 이하만 저장한다. 실제 소스/용도별 승인 기간이 더 짧으면 호출자가 R02 정책에 따라 줄여야 한다. 만료 데이터의 물리 삭제·백업/캐시 삭제 전파는 후속 작업이다.
- Revision은 부모 Observation 삭제 시 함께 삭제되고 사건 연결도 정리된다. Radar 사건/관측 삭제는 기존 질문/투표를 삭제하지 않는다. 주제 삭제는 연결 사건이 있으면 거절한다.
- R04 실행 서비스가 R02 정책과 실제 서버 설정을 확인한 뒤 저장소를 호출해야 한다. 이 모듈 자체로 수집 승인/쿼터 예약/공개 projection 권한을 부여하지 않는다. 런타임에는 아직 연결하지 않았다.
- Zod 입력 검증과 PostgreSQL CHECK/FK를 병행한다. DB URL 검사는 최소 형태 검사이며 SSRF 방어가 아니다. 사건의 최소 주제 1개 등 묶음 규칙은 저장소 검증을 거쳐야 한다. 임의 SQL writer까지 허용하는 공개 DB 인터페이스가 아니다.

## 실행과 검증

- `pnpm radar:test:db`: 격리된 로컬 환경변수만 전달해 Radar storage + 기존 질문 조회/투표 통합 테스트를 실행한다. 테스트마다 무작위 which_test_* DB를 생성하고 종료 후 제거한다. 개발 중인 which_radar DB는 삭제하지 않는다.
- 신규 설치: 전체 0000–0067 migration을 빈 테스트 DB에 적용한다.
- 업그레이드: 0000–0066만 적용한 테스트 DB에 합성 질문/투표/댓글을 넣고 0067을 적용한다. 질문·버전·선택지·투표·댓글 전체 행이 같음을 확인한다. migration 재실행과 소스 코드 중복 방지도 검사한다.
- 저장 검증: 동일 관측 동시 저장, 기대 hash 기반 동시 정정, 이력 보존, 시간대/관측창/null/0/큰 정수/비교 집단, 직접 SQL 제약 위반, 미존재 출처/질문 버전/관측 FK, 묶음 rollback, Radar 삭제 후 기존 데이터 보존.
- `pnpm radar:migrate`: 기존 로컬 전용 DB에 migration만 적용한다. seed를 다시 넣지 않으며 운영 DB 주소를 받을 수 없다.
- 현재 개발 DB에도 migration과 재실행 적용 완료. 전후 질문·버전·투표 전체 행 해시 동일, localhost 홈/상태 API 200 확인.

운영 배포는 사용자 요청 때 별도 진행한다. 다음 R04는 수집 실행 원장·중복 dispatch/lease·쿼터 예약·재시도 구현이다.

## 검증 결과 (2026-09-20 KST)

- 실제 PostgreSQL 통합 52개 통과: Radar 신규 28개 + 기존 질문 조회/투표 24개.
- schema/Radar 계약·정책/poll 단위·회귀 106개, 환경 격리 4개 통과.
- API typecheck, 변경 TypeScript ESLint, Prettier, diff 검사 통과. Drizzle 재생성에서 추가 schema 차이 없음.
- 기존 질문 조회 테스트에서 pg client.query 동시 호출 deprecation 경고가 출력됐지만 테스트 실패는 없었다. Radar 저장소는 트랜잭션 안에서 쿼리를 순차 실행한다.
- 로컬 DB만 migration 적용. 테스트 종료 후 일회성 테스트 DB와 임시 migration 복사본은 삭제했다. PR/push/운영 배포 없음.

# Radar R04 — 수집 실행 원장·재시도 (WHICH-150)

로컬 구현 / 운영 미반영. R02의 권한·호출 예산과 R03의 저장소 사이에 실행 경계를 둔다. 실제 Google/Naver/YouTube 요청, 스케줄러, Worker 배포는 아직 연결하지 않는다.

## 실행 원장

| 테이블                    | 역할                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `radar_ingestion_runs`    | 논리 수집 실행, dispatch 멱등키, lease, 시도 횟수, 최종 결과와 누락 범위   |
| `radar_provider_requests` | 실제 외부 호출 직전 예약. 페이지·재시도마다 고유 request key와 결과를 기록 |
| `radar_quota_daily_usage` | 정책 버전·소스·quota scope·공유 pool·소스별 일 경계 기준의 원자적 사용량   |
| `radar_run_quota_usage`   | 한 논리 실행의 공유 pool별 사용량                                          |

`0068_radar_ingestion_ledger.sql`은 위 테이블과 제약·인덱스만 추가한다. 기존 질문·투표와 R03 데이터는 변경하지 않는다. 상태·결과 조합, 음수 사용량, 종료된 실행의 lease 잔존, 요청 결과와 완료 시각 불일치를 PostgreSQL CHECK로 거절한다.

## 상태와 결과 의미

- `PENDING`: 실행 대기 또는 재시도 backoff 중이다.
- `RUNNING`: 한 Worker가 claim token과 만료 시각을 가진다.
- `SUCCEEDED`: 1개 이상의 관측을 끝까지 수집했다. 누락 범위와 failure code가 없어야 한다.
- `EMPTY_VALID`: 제공자가 정상 응답했지만 관측값이 0개다. 오류·빈 결과를 구분한다.
- `PARTIAL`: 일부 페이지/항목만 수집했다. failure code와 `missingCoverage` 또는 truncated 표시가 필수다.
- `FAILED`: 재시도 불가 오류이거나 최대 시도를 소진했다.

`missingCoverage`에는 “page 2 and later were not collected”처럼 사람이 이해할 수 있는 범위만 기록한다. 제공자 cursor, access token, 서명 URL, 원문 응답은 저장하지 않는다.

## 멱등성과 동시 실행

- scheduler는 논리 표본마다 안정적인 `dispatchKey`를 사용한다. 같은 키·같은 입력은 기존 run을 반환하고, 같은 키에 다른 소스/메서드/시각/정책을 재사용하면 충돌로 거절한다.
- Worker claim은 `FOR UPDATE SKIP LOCKED`로 한 실행을 한 Worker만 가져간다. claim token은 fencing token이다. lease가 끝난 Worker는 결과 저장·예산 예약·lease 갱신을 할 수 없다.
- 만료된 lease는 남아 있던 `RESERVED` 요청을 `LEASE_EXPIRED`로 닫은 뒤 새 token으로 회수한다. 마지막 시도까지 소진했으면 run과 미완료 요청을 terminal failure로 함께 닫는다.
- provider request key는 run 안에서 유일하다. 동일 키 재예약은 사용량을 다시 차감하지 않지만, collector가 같은 외부 요청을 다시 보내지 못하게 중복으로 처리한다. 페이지와 재시도는 각각 새 키를 사용해야 한다.

## timeout과 재시도

- lease는 수집 timeout보다 길어야 한다. timeout은 `AbortSignal`을 전달하고 run을 재시도 대상으로 되돌린다. lease fencing은 취소 이후 늦게 끝난 작업의 쓰기를 막는다.
- HTTP 429, 408, 5xx와 timeout/일시적 upstream 오류만 재시도한다. 401/403, 잘못된 응답, 정책 거절, 예산 소진은 자동 재시도하지 않는다.
- backoff는 시도 횟수 기반 지수 증가와 상한을 적용한다. 429의 검증된 `Retry-After`가 더 길면 그 시각을 존중한다.
- 최대 시도에 도달하면 `FAILED`로 종료한다. 제공자 오류 문자열·응답 본문·URL 대신 정규화한 failure code와 일반화된 메시지만 저장한다.

## 호출 예산 예약

1. 신뢰된 서버 activation이 run의 source, quota scope, policy version과 정확히 같은지 확인한다.
2. live claim을 행 잠금으로 검증한다.
3. 일별 원장과 실행별 원장을 잠그고 R02의 메서드/pool 상한을 평가한다.
4. 두 원장 증가와 provider request 예약을 한 transaction에서 확정한다.
5. 그 뒤에만 adapter가 네트워크 요청을 수행한다.

외부 요청은 실패·timeout이 나도 이미 소비된 것으로 유지한다. 재시도와 pagination도 별도 차감된다. 프로세스 메모리 카운터나 검사 후 별도 증가 방식은 사용하지 않는다. 이 원장은 WHICH 내부 안전 상한이며 제공자의 실제 잔여 quota를 대신하지 않는다.

## 모듈 경계

`createRadarIngestionService(database, options)`는 서버 내부 서비스다. HTTP 공개 라우트가 아니며 사용자 입력으로 activation을 만들지 않는다. R05–R07 adapter는 `processClaim`의 context를 통해서만 provider 요청을 수행하고, 정규화가 끝난 결과를 R03 저장소에 전달해야 한다.

현재 로컬 환경에서는 외부 수집, cron, 실제 인증정보, 운영 DB가 모두 비활성이다. 따라서 이 완료는 자동 수집 활성화나 소스 이용 권한 승인을 의미하지 않는다.

## 검증 결과 (2026-09-20 KST)

- 실제 PostgreSQL 통합 80개 통과: 실행 원장 28개 + Radar 저장소 28개 + 기존 질문 조회/투표 24개.
- 실행 원장 검증: 동시 중복 dispatch, dispatch key 충돌, 권한 fail-closed, 단일 claim, lease 회수/fencing/최대시도 종료, 성공·정상빈결과·부분결과, 429/5xx/timeout backoff, 비재시도 401/403/404, 원자적 일별·실행별 예산, 중복 request key, 민감 오류 미저장.
- schema/Radar 계약·정책/poll 단위·회귀 106개와 로컬 환경 격리 4개 통과.
- API typecheck, 변경 TypeScript ESLint, Prettier, diff 검사, Drizzle schema 재생성 확인을 수행한다.
- 로컬 전용 DB에 migration을 재실행해도 기존 질문·버전·투표 행 해시가 유지되는지 확인한다. PR/push/운영 배포/실수집은 하지 않는다.

다음 R05는 이 실행 서비스를 사용하는 Google Trending RSS adapter를 fixture/mock 우선으로 구현한다.

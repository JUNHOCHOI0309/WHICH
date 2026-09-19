# Radar R01: 도메인과 관측 계약

## 제품 경계

트렌드와 선택 경험은 독립적으로 유용해야 한다. 기존 질문을 트렌드 전용으로 바꾸거나 모든 사건에 질문을 생성하지 않는다. [백로그](../product/radar-implementation-backlog.md)와 Notion 실행 계획을 따른다.

## 모델

| 개념        | 책임                    | 연결                                        |
| ----------- | ----------------------- | ------------------------------------------- |
| Topic       | 지속되는 주제·개체      | 여러 Event에 연결                           |
| Event       | 시점과 맥락이 있는 사건 | 여러 Topic, 0개 이상 IssueVersion           |
| Evidence    | 출처가 있는 주장        | Event에 연결, 지지/부분/상충/미확인/철회    |
| Observation | 소스가 반환한 관측값    | 출처·지표·범위·관측창·샘플시각으로 식별     |
| Issue link  | 기존 질문 버전과의 연결 | Issue/Vote를 복제·수정하지 않는 다대다 관계 |

R01은 런타임 스키마와 순수 정규화만 제공한다. DB/FK·migration은 R03, 실제 수집과 외부 응답 parsing은 R04–R07, 공개 projection은 R10–R11이다. 기존 PollSource/YouTube 검증은 변경하지 않는다. 공개 URL, 예약 작업, AI 요청, 운영 환경변수는 추가하지 않는다.

## 관측 식별과 보정

질문 연결은 기존 `issue_versions`의 `(issueId, issueVersion)` 복합키를 사용한다. 새로운 질문 버전 UUID를 만들지 않는다.

- sourceItemId/queryKey/dimensionsKey/comparisonKey는 어댑터가 결정하는 명시적 식별자다. 필터·언어·장치 등 결과 의미에 영향을 주는 차원은 dimensionsKey에 포함한다.
- sampledAt은 논리적 수집 실행 시작 시 한 번 고정하고 재시도에도 재사용한다. sourceUpdatedAt은 소스가 제공한 시각이며 없으면 null이다.
- observationKey는 versioned tuple의 SHA-256. 출처·원본 ID·지표·종류·비교집단·범위·관측창·샘플시각을 포함한다.
- 동일 샘플의 값 수정은 같은 observationKey / 다른 contentHash다. R03은 충돌을 조용히 무시하지 말고 보정 이력을 보존해야 한다. 다음 샘플은 같은 값이어도 새 관측이다.
- URL fragment만 제거하고 query는 보존한다. 표시 제목은 NFC/공백 정규화; provider 식별자를 임의 소문자화하지 않는다.

## 지표와 최신성

- COUNT는 정확한 비음수 정수, LOWER_BOUND는 구간 하한(예: 1000+)이다. 서로 바꿔 해석하지 않는다.
- RELATIVE_INDEX는 0–100이며 비교 집단을 반드시 명시한다. 서로 다른 집단 값을 직접 합산/순위화하지 않는다.
- RANK는 1부터 시작하며 차트/비교 범위를 명시한다.
- null은 미제공, 0은 실제 관측값. 데이터 미수집을 0으로 채우지 않는다.
- 성공/정상빈결과/부분결과/실패는 수집 실행 상태. stale은 성공 여부와 별개로 소스별 주기 및 관측 시각을 사용해 R10에서 계산한다.
- 발생시각·원문게시시각·관측시각은 별도다. unknown 발생시각을 수집시각으로 채우지 않는다.

## 보안과 권한

소스 URL 스키마는 HTTPS/credential 금지만 검증하며 SSRF 방어가 아니다. 어댑터는 host allowlist, DNS/IP, redirect, timeout, 응답 크기 및 XML entity 제한을 별도 적용해야 한다. 외부 제목/본문은 신뢰하지 않는 데이터이며 HTML/명령으로 실행하지 않는다. 계약이 존재하는 것은 해당 데이터의 재표시·파생·장기보존 권한이 승인됐다는 뜻이 아니다.

## 검증

`pnpm --filter @which/api exec vitest run test/radar-contracts.test.ts test/poll-candidates.test.ts`

날짜/offset·지표범위·null/0·멱등성·보정·관측 차원·비교집단·부분 실패·사건시각 정밀도를 고정 fixture로 검증한다. 네트워크·운영 DB·비밀 값 없이 실행한다.

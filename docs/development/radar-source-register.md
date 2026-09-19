# Radar 소스 등록·권한·보존·호출 예산 (R02 / WHICH-148)

최초 확인일: **2026-09-19**, NAVER API HUB 및 YouTube Data API 재확인일: **2026-09-20**. 로컬 구현이며 운영 미반영. 법적 이용 허가를 새로 취득하거나 약관을 대신 수락한 결과가 아니다.

## 실행 상태

모든 소스 기본값은 `enabled=false`, `killSwitch=true`다. 수집·저장·재표시·파생·AI 추론 권한은 각각 `UNKNOWN`, 학습은 WHICH 내부 정책으로 `DENIED`다. API 문서 공개/HTTP 200/키 존재를 이용 권한 승인으로 해석하지 않는다. 따라서 현재 실제 수집/요금 발생/외부 전송은 없다.

등록부: `apps/api/src/modules/radar/source-registry.ts`. 검증 함수: `source-policy.ts`.
이번 구현은 **순수 사전 검사**이며 서버·스케줄러에 연결된 수집기나 원자적 쿼터 예약기가 아니다. R04 실행 원장과 R05–R07 어댑터가 아래 계약을 적용해야 한다. 기존 YouTube.js 투표 후보 수집기에는 변경이 없다.

## 공식 근거와 확인되지 않은 부분

### Google Trending RSS

- [Trending now 도움말](https://support.google.com/trends/answer/3076011?hl=en): 공식 RSS 내보내기와 평균 약 10분 갱신 안내. 검색량은 구간화된 값이므로 정확한 검색 횟수로 표시하지 않는다.
- 문서의 RSS 제공 사실은 상업적 재표시·기사 본문/이미지 복제·장기 보관·파생 지표·모델 학습의 포괄적 허가가 아니다. 해당 용도와 보존 조건은 아직 미확인이다.
- 인증 키 없는 연결이지만 활성화 전 사용 범위·귀속 표시·삭제 정책 검토 기록이 필요하다. 원문 뉴스 URL을 따라가 본문/이미지를 자동 복제하지 않는다.

### Google Trends API Alpha (실행 불가 후보)

- [공식 Alpha 안내](https://developers.google.com/search/apis/trends): 신청 기반의 제한된 접근. WHICH 계정 승인 증거가 없다.
- 실행 소스 enum/어댑터에 포함하지 않는다. 승인 여부와 상관없이 현재 `GOOGLE_TRENDS_ALPHA` 요청은 검증 실패한다. 미승인 상태를 비공식 API로 우회하지 않는다.
- Alpha의 보존·재표시·파생 조건/실제 배정 쿼터도 미확인. RSS의 권한을 Alpha에 전이하지 않는다.

### Naver Search / DataLab

- [NAVER API HUB 개요](https://guide.ncloud-docs.com/docs/apihub-overview): 2026-09-20 현재 신규 신청 기준은 API HUB다. NAVER 검색은 월 최대 775,000건, 검색어 트렌드는 월 최대 50,000건이고 API key당 50 RPS다. 아래 예산은 이 외부 한도가 아니라 더 낮은 WHICH 내부 상한이다.
- [API HUB 이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration): 새 Hub 도메인과 `X-NCP-APIGW-API-KEY-ID`/`X-NCP-APIGW-API-KEY`를 사용한다. 기존 Developer Center 키·헤더로 자동 fallback하지 않는다.
- [뉴스 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-news): 관련 뉴스 검색 결과를 다루는 API이지 실시간 인기 검색어 순위 API가 아니다. 제목/요약의 `<b>` 강조만 제거하고 원문 URL을 보존하며 링크를 따라가지 않는다.
- [검색어 트렌드](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend): 지정 키워드 묶음의 상대 검색 추이. 0–100 값을 절대 검색량이나 서로 다른 요청 간 같은 척도로 취급하지 않는다. API reference의 그룹당 20개와 Hub 개요 FAQ의 5개가 충돌하므로 구현은 더 낮은 5개를 적용한다.
- 앱 등록·각 API 선택·서버 전용 Client ID/Secret 확인이 필요하다. 이번 작업에서는 발급/조회/등록하지 않았다.
- [개발자 약관 URL](https://developers.naver.com/terms/)은 이번 도구에서 본문 조회 실패. 메서드 명세만으로 재배포·보존 기간·가공·AI 추론/학습 권한을 확정하지 않았다. 권리자가 다른 뉴스 본문/이미지 사용 허가도 별개다. 활성화 전에 현재 약관 원문과 서비스 용도의 적합성을 확인해야 한다.

### YouTube Data API

- [search.list](https://developers.google.com/youtube/v3/docs/search/list)는 주어진 질의·필터에 맞는 관련 동영상을 찾는다. 반환 순서는 해당 요청 안에서만 기록하며 YouTube 전체 인기 차트로 부르지 않는다.
- [videos.list](https://developers.google.com/youtube/v3/docs/videos/list)의 `id` 조회는 명시된 영상의 현재 통계 스냅샷이고, `chart=mostPopular`은 지역·카테고리 범위의 별도 차트다. 2025-07-21 이후 `mostPopular`은 Trending Now 목록과 같다는 의미가 아니므로 WHICH의 “실시간 트렌드”로 바꿔 부르지 않는다.
- [공식 쿼터 표](https://developers.google.com/youtube/v3/determine_quota_cost) (페이지 갱신 2026-09-15): 기본값은 search.list 100회/일 별도 버킷, 기타 메서드 합산 10,000 units/일. 이번 허용 목록의 search.list/videos.list/channels.list는 각각 1 단위/호출이다. 잘못된 요청·다음 페이지도 소비하며 PT 자정에 초기화한다. 과거의 search.list=100 units 가정을 사용하지 않는다. 실제 프로젝트 할당은 아직 확인하지 않았다.
- [Developer Policies III.E.4](https://developers.google.com/youtube/terms/developer-policies): 비인가 데이터의 제한적 보관은 최대 30일이며 삭제/갱신 등 조건이 따른다. 원시 API 지표를 바꾸거나 새 지표를 만드는 행위에도 제한이 있다. 재표시는 최신성·출처 등 정책 검토를 별도로 거쳐야 한다.
- [추가 파생 지표·보관 정책](https://developers.google.com/youtube/terms/derived-metrics-policy): 추가 약정 수락 및 적합한 분석 용도에 한해 일부 파생 지표와 통계 최대 36개월 보관을 허용하는 조건이 있다. 제목/설명/댓글 텍스트 등에는 여전히 30일 갱신/삭제 조건이 남는다. WHICH의 수락/용도 승인 증거가 없으므로 이 예외를 적용하지 않는다. 기본 개발자 정책과 충돌하는 것처럼 보여도 더 넓은 허용으로 자동 해석하지 않는다.
- 조회수·관심도는 WHICH 투표 결과와 구분하며 통합 점수 생성 권한을 추정하지 않는다. 학습, 민감 속성 추론, 댓글/영상 원문 대량 복제는 활성화 대상이 아니다.

## WHICH 내부 예산 (제공자 할당량 아님)

| 소스 / 메서드                       | 공유 풀         | 실행당 요청/단위 | 일별 요청/단위 | 내부 일 경계        |
| ----------------------------------- | --------------- | ---------------: | -------------: | ------------------- |
| Google RSS                          | google-rss      |            1 / 1 |      144 / 144 | UTC                 |
| Naver news.search                   | naver-search    |          10 / 10 |      300 / 300 | Asia/Seoul          |
| Naver search.trend                  | naver-datalab   |            5 / 5 |        50 / 50 | Asia/Seoul          |
| YouTube search.list                 | youtube-search  |            2 / 2 |        20 / 20 | America/Los_Angeles |
| YouTube videos.list + channels.list | youtube-general |     합산 50 / 50 | 합산 500 / 500 | America/Los_Angeles |

이는 비용/트래픽을 제한하는 초기 내부 상한이며 실행 일정·제공자의 속도 제한을 보장하지 않는다. 네이버 일 경계는 WHICH 내부 기준이고 제공자 리셋 시각을 확인한 주장도 아니다. 재시도·pagination은 매 요청 별도 차감한다. 무등록 메서드·upload/write는 불허한다. 실제 프로젝트의 다른 서비스 소비량을 포함한 잔여 쿼터가 더 작으면 그 잔여량을 우선 적용해야 한다. RSS 갱신 안내도 144회/일 호출 허가를 의미하지 않는다.

## 보존·권한 검증

- `collect/store/redisplay/derive/inference/train`은 별도 권한. 수집 전에 collect+store, 저장 자료 사용 전 store+해당 용도를 검사한다.
- APPROVED에는 비밀정보 없는 근거 URL·검토자·확인 시각·만료 시각이 필요하다. unknown/denied/미래 확인일/만료/빈 근거는 거절한다. 사용자 요청 본문이 아니라 검토된 서버 설정만 입력한다.
- 저장 기간은 기본 null(미확인). 승인 후에도 이번 단계의 WHICH 내부 상한은 **24시간**, 용도별 허용 기간이 더 짧으면 더 짧게 설정한다. 24시간 자체가 제공자의 허가는 아니다. 장기 보관은 별도 설계/권리 검증 없이 켤 수 없다.
- 원래 fetchedAt 기준 TTL을 검사하고 만료 순간부터 읽기/표시/파생을 거절한다. 읽기 시각으로 수명을 연장하지 않는다. 실제 삭제 배치·백업/로그/파생물 삭제 전파는 후속 보존 작업에 필요하다. 사전 검사가 삭제를 실행하지는 않는다.
- NAVER 이관 및 YouTube 어댑터의 공식 메서드 근거를 반영해 정책 버전을 `radar-sources-2026-09-20-v3`로 올렸다. 내부 재검토 기한은 **2026-10-19 00:00 UTC**이며 그 이후 일괄 fail-closed다. 제공자가 정한 갱신 의무일이 아니라 내부 정책 재검토일이다.
- 자동 학습은 승인 필드만 바꾸어도 열리지 않는다. 알파 연결도 현재 어댑터가 없으므로 열리지 않는다.

## 후속 실행 원장(R04) 연결 계약

1. 신뢰된 서버 설정을 읽고 실제 앱/프로젝트 권한·잔여 한도를 확인한다. 키/토큰/비밀 URL을 등록부나 로그에 저장하지 않는다.
2. DB 시간으로 now를 정하고 `(quotaScopeId, pool, dayKey)` 및 논리 runId의 사용량을 잠금/트랜잭션으로 읽는다. 중복 dispatch·재시도는 동일 runId를 사용한다. 메서드가 달라도 같은 pool이면 합산한다.
3. `evaluateRadarRequest` 성공과 사용량 증가를 **같은 원자적 예약 작업**으로 수행한 뒤 네트워크를 호출한다. 스냅샷만 검사한 뒤 별도 증가하면 동시 실행 때 상한을 넘는다. 프로세스 메모리 카운터는 불가하다.
4. 실패·timeout·429도 사용량을 되돌리지 않는다. 새 날짜도 적절한 시간대의 새 원장 행으로 전환하고 날짜/스코프 불일치를 0으로 간주하지 않는다. 제공자 오류의 backoff는 별도 적용한다.
5. 저장 직전/조회 직전 권한 만료·kill switch·TTL을 다시 검사한다. 만료/취소 시 공개 캐시와 파생 경로까지 차단해야 한다.
6. 실제 어댑터는 호스트/리다이렉트 허용 목록, 응답 크기·timeout 제한, 최소 필드 저장, 표시 출처를 구현한다. 이 등록부는 URL 요청의 SSRF 방어 구현이 아니다.

## 검증

`apps/api/test/radar-source-policy.test.ts`: 기본 비활성, 알파 차단, 권한 분리/만료, kill switch, 보존 만료, 경계 예산, 잘못된 수치, 공유 버킷, 정책/프로젝트/run/날짜 불일치, PT 일 경계/DST를 합성 승인과 카운터로 검증한다. 실제 승인·실수집·동시 DB 예약 검증으로 보고하지 않는다.

이 조사·정책 등록 단계 완료는 수집 운영 승인과 다르다. 다음 작업 R03은 로컬 DB 모델/마이그레이션이다.

2026-09-19 로컬 검증 결과: 신규 정책 테스트 52개 + 기존 Radar/poll 회귀 46개 = **98개 통과**. 로컬 환경 격리 테스트 4개, API typecheck, 변경 TypeScript ESLint, diff 공백 검사 통과. PR/push/배포/실수집 없음.

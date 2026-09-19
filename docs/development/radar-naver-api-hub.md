# Radar R06 — NAVER API HUB 검색·DataLab 어댑터 (WHICH-152)

로컬 구현 / 운영 미반영. 발견 키워드의 관련 뉴스와 일간 검색어 트렌드를 NAVER API HUB에서 읽을 수 있는 서버 내부 어댑터다. 실제 Application 신청·약관 수락·자격증명 발급, 자동 수집·저장·공개·질문 생성은 수행하지 않는다.

## 2026 API HUB 전환

2026-09-20 현재 신규 신청은 NAVER Developers Center가 아니라 NAVER API HUB 기준이다. 구현은 아래 두 endpoint만 허용하며 기존 `openapi.naver.com`이나 구 인증 헤더로 fallback하지 않는다.

| 데이터        | 메서드·endpoint                                                    |
| ------------- | ------------------------------------------------------------------ |
| 관련 뉴스     | `GET https://naverapihub.apigw.ntruss.com/search/v1/news`          |
| 검색어 트렌드 | `POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search` |

인증은 서버 환경변수 `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET`만 읽고 각각 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` 헤더로 보낸다. `NEXT_PUBLIC_*`, 응답 객체, 오류 메시지, DB 원장에는 넣지 않는다. 자격증명이 없거나 줄바꿈 등 안전하지 않은 값이면 네트워크 호출 전에 `AUTH`로 거절한다.

정책 등록부도 현재 공식 문서로 바꾸고 버전을 `radar-sources-2026-09-20-v2`로 올렸다. 모든 Naver 소스는 여전히 기본 비활성·kill switch 상태이고 실제 계정의 collect/store/redisplay/derive 권한과 보존 기간은 미승인이다.

## 분리된 데이터 의미

### 뉴스 검색

`collectNaverNews`는 뉴스 결과를 `NaverNewsRecord[]`로 반환한다. Radar 수치 관측으로 변환하지 않는다.

- 검색어, 원문/Naver URL, 제목, 요약, 게시 시각, WHICH 관측 시각을 보존한다.
- 응답의 `<b>` 검색어 강조만 제거하고 표준 문자 entity를 제한적으로 복원한다. 다른 태그·알 수 없는 entity는 거절한다.
- 기사 URL은 검증만 하며 따라가거나 본문·이미지를 복제하지 않는다.
- 동일 검색어+기사 URL+게시 시각으로 안정적인 source item ID를 만든다.
- `total`은 응답 메타데이터일 뿐 관심도·기사량 관측값으로 저장하지 않는다.

이는 R08 사건 연결 단계에서 사용할 **근거 후보 입력**이다. 현재 자동으로 `radar_evidence`에 저장하지 않는다.

### 검색어 트렌드

`collectNaverSearchTrend`는 일간 결과만 받고 `RadarObservation[]`의 `RELATIVE_INDEX`로 변환한다.

- 값 100은 절대 검색량이 아니라 **한 요청의 전체 키워드 그룹·기간·필터 안에서의 최대값**이다.
- start/end, 모든 groupName/keywords, device/gender/ages를 collection의 comparison 객체에 그대로 유지하고 그 전체의 SHA-256을 모든 관측의 `comparisonKey`로 공유한다.
- 서로 다른 요청의 50과 50을 같은 양으로 비교하지 않는다. 양수 데이터가 있으면 요청 전체에 최대값 100이 존재해야 한다.
- 제공자가 갱신 시각을 주지 않으므로 `sourceUpdatedAt`을 수집 시각으로 꾸미지 않고 `null`로 둔다.
- 날짜는 Asia/Seoul의 해당 일간 창으로 변환한다. 빈 `results`는 0을 만들어내지 않고 `EMPTY_VALID`로 반환한다.

공식 API reference는 그룹당 최대 20개 검색어라고 쓰지만 API HUB 개요 FAQ는 최대 5개라고 안내한다. 문서가 일치할 때까지 더 보수적인 그룹당 5개, 요청당 5개 그룹을 적용한다.

## HTTP·실행 경계

- endpoint/HTTPS host 고정, redirect `manual`, 응답 URL 변경 거절
- 기본 timeout 5초, JSON stream 512 KiB 상한, UTF-8 fatal decoding
- `application/json`과 엄격한 필드/범위/날짜 검증
- 401/403 `AUTH`, 429 `RATE_LIMIT`, 408/504 `TIMEOUT`, 5xx `UPSTREAM`; provider body·URL·비밀 값은 원장 오류에 저장하지 않음
- 모든 실제 요청은 R04 `request(operation, requestKey, ...)`를 먼저 통과해 news와 DataLab의 서로 다른 내부 예산 풀에 기록
- API HUB의 현재 외부 한도와 별개로 WHICH 내부 상한은 news 일 300, trend 일 50으로 유지

## 실행과 검증

```powershell
pnpm radar:test:naver
pnpm radar:test:db
```

기본 테스트는 합성 JSON만 사용한다. 승인된 API HUB Application이 준비된 경우에만 서버 프로세스에 두 환경변수를 넣고 아래 gated smoke를 별도로 실행한다.

```powershell
$env:RADAR_NAVER_API_HUB_SMOKE='1'
pnpm radar:test:naver
Remove-Item Env:RADAR_NAVER_API_HUB_SMOKE
```

fixture/mock 검증은 인증 누락, 새 헤더·endpoint, 401/403/429/5xx, timeout, redirect/content-type/stream 크기, 뉴스 HTML/entity/빈 결과, 검색어 묶음·일간 창·요청 전체 최대값100·빈 결과·불일치 응답을 포함한다. PostgreSQL 통합 테스트는 news와 trend가 각각 `naver-search`, `naver-datalab` 원장에 예약·완료되는지 확인한다.

2026-09-20 로컬 검증 결과:

- NAVER fixture/mock 경계 15개 통과, 승인 자격증명이 필요한 gated live smoke 1개 skip
- PostgreSQL 통합 83개 통과(이 중 NAVER news/trend → R04 원장 연결 2개)
- Radar schema/계약/정책/poll 단위·회귀 106개와 로컬 격리 profile 4개 통과
- API typecheck, 변경 TypeScript ESLint, Prettier, `git diff --check`, localhost web/live/ready 200 확인 통과

실제 API HUB 자격증명과 이용 승인이 제공되지 않았으므로 live smoke는 실행하지 않았다. 이는 통과로 기록하지 않으며 활성화 전 Application의 API 선택, 월/일 한도, 비용 알림, 약관·재표시·보존 권한을 확인해야 한다.

## 공식 근거

- [API HUB 이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration)
- [API HUB 개요·한도](https://guide.ncloud-docs.com/docs/apihub-overview)
- [뉴스 검색 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)
- [검색어 트렌드 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)

운영 배포는 사용자 요청 때 별도 진행한다. 다음 R07은 기존 YouTube.js 커뮤니티 투표 수집과 분리된 YouTube 공식 Data API 영상 신호 어댑터다.

# Radar YouTube Data API 영상 신호 어댑터 (R07 / WHICH-153)

2026-09-20 로컬 구현이며 운영 미반영이다. API 키 발급·약관 수락·quota 증설·실수집·스케줄 등록·배포를 수행하지 않았다. 기존 `youtubei.js` 커뮤니티 투표 수집기는 이 어댑터와 코드·실행 원장·자격증명이 서로 독립이다.

## 세 가지 신호의 경계

| 함수                             | 공식 메서드                     | 결과 의미                                                                   | 하지 않는 주장                                                 |
| -------------------------------- | ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `searchYouTubeVideos`            | `search.list`                   | 질의·정렬·지역·언어·기간·요청 개수로 제한된 관련 영상 후보와 응답 내부 순서 | YouTube 인기 차트 또는 플랫폼 전체 순위가 아님                 |
| `collectYouTubeVideoStatistics`  | `videos.list?id=...`            | 명시한 최대 50개 영상의 조회·좋아요·댓글 수 스냅샷                          | 누락 통계를 0으로 만들거나 참여율 같은 파생 지표를 만들지 않음 |
| `collectYouTubeMostPopularChart` | `videos.list?chart=mostPopular` | 지역·선택적 카테고리·응답 개수로 제한된 `mostPopular` 순위                  | Trending Now 또는 WHICH 통합 트렌드 점수와 동일하지 않음       |

`search.list`의 `pageInfo.totalResults`는 제공자 문서대로 근삿값이므로 `approximateTotalResults`로만 전달한다. 다음 페이지 존재 여부는 토큰 자체를 저장하지 않고 boolean으로만 반환한다. 이번 어댑터의 한 호출은 요청한 한 페이지의 완전성만 나타내며 전체 검색 결과를 다 가져왔다고 주장하지 않는다.

## 삭제·비공개·숨김 통계

- `videos.list` 응답에 요청 ID가 없으면 삭제·비공개·지역 제한 등 구체 원인을 추정하지 않고 `missingVideoIds`에 기록한다.
- 모두 누락되면 `EMPTY_VALID`이며 조회수 0 관측치를 만들지 않는다.
- `likeCount` 또는 `commentCount`가 응답에 없으면 해당 관측치를 생략한다. 0 문자열이 실제로 반환된 경우에만 0으로 기록한다.
- 입력 video ID는 순서를 보존해 중복 제거한다. 50개를 넘는 고유 ID는 호출 전에 거절한다.
- 영상 resource의 조회·좋아요·댓글 수는 지역별 수치가 아닌 전역 스냅샷이다. 공통 계약의 국가 필드에는 미지정/전역을 뜻하는 내부 코드 `ZZ`를 넣고 `geo=global` 차원을 함께 기록한다. `mostPopular` 순위만 요청 `regionCode`를 사용한다.

## 보안·quota 경계

- 서버 전용 `YOUTUBE_DATA_API_KEY`만 사용한다. 브라우저 환경변수나 반환 객체, 예외 메시지에 키를 넣지 않는다.
- 호스트와 경로는 `https://www.googleapis.com/youtube/v3/search|videos`로 고정하고 redirect를 따라가지 않는다.
- 5초 timeout, 512 KiB 응답 제한, JSON MIME·UTF-8·필드 형식을 검증한다.
- `quotaExceeded`/`dailyLimitExceeded`는 즉시 재시도하지 않는 `RATE_LIMIT`, 단기 `rateLimitExceeded`는 재시도 가능한 `RATE_LIMIT`으로 분류한다. 요청이 실제 API에 전달됐다면 실패도 R04 원장의 quota 예약을 되돌리지 않는다.
- 내부 예산은 `search.list` 2회/run·20회/day 별도 풀, `videos.list`/`channels.list` 합산 50회/run·500회/day다. 이는 Google Cloud 프로젝트 실제 할당량보다 낮은 WHICH 상한일 뿐이다.

## 권한·보존

기본 activation은 `enabled=false`, `killSwitch=true`, collect/store/redisplay/derive/inference 권한 `UNKNOWN`이다. R04가 검토된 서버 activation으로 collect+store를 모두 승인하기 전에는 네트워크 호출에 도달하지 않는다.

비인가 API 데이터의 내부 보존 상한은 24시간이다. 이는 YouTube가 부여한 허가가 아니며, 현재 정책의 최대 30일보다 더 짧은 fail-closed 상한이다. 최신성 검증·삭제 전파를 전제로 하지 않은 장기 보존은 열지 않는다. YouTube 통계를 결합한 참여율·점수·예측 등 파생 지표도 별도 추가 약정과 용도 승인이 확인되기 전에는 생성하지 않는다. 원시 YouTube 통계는 WHICH 투표·추천 통계와 출처를 분리한다.

## 검증

기본 검사는 외부 호출 없이 고정 fixture만 사용한다.

```powershell
pnpm radar:test:youtube
```

검증 범위는 정책 거절, 고정 endpoint/API key 비노출, quota/auth/upstream 구분, timeout·크기·MIME 제한, 관련 검색 범위, 중복 검색 결과, 중복 요청 video ID, 삭제·비공개로 추정하지 않는 누락 ID, 숨김 통계, `mostPopular` 비교 범위다.

승인된 프로젝트와 현재 정책 검토가 끝난 뒤에만 별도 셸에서 서버 환경변수를 주입하고 일회성 읽기 smoke를 실행한다. 로컬 고정 프로필은 운영 비밀 값을 상속하지 않으므로 기본적으로 이 테스트는 skip된다.

```powershell
$env:RADAR_YOUTUBE_DATA_API_SMOKE = "1"
$env:YOUTUBE_DATA_API_KEY = "<server-only-key>"
pnpm radar:test:youtube
```

smoke는 결과를 DB에 저장하거나 공개하지 않는다. 사용 후 같은 셸에서 환경변수를 제거한다.

2026-09-20 로컬 검증 결과:

- YouTube fixture/mock 경계 15개 통과, 승인 API 키가 필요한 gated live smoke 1개 skip
- PostgreSQL 통합 85개 통과(이 중 YouTube `search.list`/`videos.list` → R04 quota 원장 연결 2개)
- Radar schema/계약/정책/poll 단위·회귀 115개, Google 22개(+ live 1 skip), NAVER 15개(+ live 1 skip), 로컬 격리 profile 4개 통과
- API typecheck·ESLint, 전체 Prettier, `git diff --check`, localhost web/API live/ready 200 확인 통과

실제 `YOUTUBE_DATA_API_KEY`와 용도 승인이 제공되지 않았으므로 live smoke는 실행하지 않았다. 따라서 운영 접근·실제 quota·현재 프로젝트의 API enablement를 통과로 기록하지 않는다.

## 공식 근거

- <https://developers.google.com/youtube/v3/docs/search/list>
- <https://developers.google.com/youtube/v3/docs/videos/list>
- <https://developers.google.com/youtube/v3/determine_quota_cost>
- <https://developers.google.com/youtube/v3/revision_history>
- <https://developers.google.com/youtube/terms/developer-policies>
- <https://developers.google.com/youtube/terms/derived-metrics-policy>

# Radar R05 — Google Trending RSS 어댑터 (WHICH-151)

로컬 구현 / 운영 미반영. Google Trends의 공개 KR RSS를 한 번 읽어 R01 관측 계약과 R04 실행 원장에 전달하는 서버 내부 어댑터다. cron, 실제 저장·공개 projection, 질문 생성·자동 게시는 연결하지 않는다.

## 고정 수집 경계

- URL: `https://trends.google.com/trending/rss?geo=KR`. 호출자가 URL·geo·host를 바꿀 수 없다.
- GET 1회, redirect `manual`. 3xx, 최종 URL 변경, 200 이외 상태, 예상하지 않은 Content-Type을 거절한다.
- 기본 timeout 5초, 압축 해제 후 본문 256 KiB, 항목 100개, XML 중첩 16단계 상한을 둔다. Content-Length와 실제 stream 누적 바이트를 모두 검사한다.
- `application/rss+xml`, `application/xml`, `text/xml`만 허용한다. UTF-8 decoding 오류와 빈 본문은 유효한 빈 feed가 아니다.
- 429/408/5xx/timeout은 R04가 재시도할 수 있는 정규화 오류로 전달한다. redirect, 형식·크기·타입·XML 오류는 `INVALID_RESPONSE`로 종료한다.

이 경계는 RSS endpoint만 요청한다. feed에 포함된 뉴스 URL·이미지 URL을 따라가거나 기사 본문·이미지를 복제하지 않는다.

## XML 안전 처리

런타임 parser는 `fast-xml-parser` 5.10.1이다. XML 크기를 먼저 제한하고 `DOCTYPE`/`ENTITY` 선언을 parser 전에 거절한다. parser의 entity 처리는 비활성화하며, 이후 XML 표준 5개 entity와 유효한 숫자 문자 참조만 제한적으로 복원한다. 알 수 없는 entity, 잘못된 Unicode code point, malformed XML은 거절한다.

이 방어는 parser가 DOCTYPE entity를 지원하고 과거 entity 확장·encoding 관련 보안 권고가 있었던 점을 고려한 중첩 방어다. 라이브러리 기본 처리에만 의존하지 않는다.

- [fast-xml-parser 프로젝트](https://github.com/NaturalIntelligence/fast-xml-parser)
- [DOCTYPE entity expansion 권고](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-jmr7-xgp7-cmfj)
- [entity encoding 우회 권고](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-m7jm-9gc2-mpf2)

## 데이터 의미

| RSS 값               | Radar 값                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `title`              | query/title. NFC·공백 정규화만 수행                                       |
| `ht:approx_traffic`  | `LOWER_BOUND`. `10K+`는 정확히 10,000회가 아니라 최소 10,000이라는 뜻     |
| `pubDate`            | `sourceUpdatedAt`과 SNAPSHOT 관측 시각. WHICH 수집 시각으로 대체하지 않음 |
| 실제 fetch 완료 시각 | `fetchedAt`                                                               |
| 논리 run의 시각      | 모든 재시도가 공유하는 `sampledAt`                                        |

raw traffic label도 collection record에 유지한다. source item ID는 `KR + 정규화 title + pubDate`의 SHA-256으로 결정해 같은 feed 재시도는 같은 ID가 되고, 다른 발표 시각은 별도 source item이 된다. 동일 항목의 완전 중복은 한 번만 반환하고 값이 충돌하면 feed 오류로 거절한다.

항목이 0개인 올바른 RSS channel은 `EMPTY_VALID`, 하나 이상이면 `SUCCEEDED`다. malformed/과대/위험 feed를 빈 결과로 바꾸지 않는다. RSS가 한 페이지이므로 부분 결과를 만들지 않고 전체 feed를 검증한 뒤 반환한다.

## R04 연결

`collectGoogleTrendingRss(context, options)`는 반드시 R04 collector context의 `request("trending.rss", requestKey, ...)`를 통과한다. 따라서 실제 요청 전에 일별·실행별 예산이 원자적으로 예약되고 결과가 provider request 원장에 남는다. retry마다 새 request key를 써야 한다.

R05는 수집 결과를 자동 저장하지 않는다. R08의 정규화·사건 연결 및 R09의 scheduler/worker 활성화 전에 권한과 retention을 다시 확인해야 한다. 현재 R02 activation 기본값은 계속 비활성이다.

## 실행과 검증

```powershell
pnpm radar:test:google
$env:RADAR_GOOGLE_RSS_SMOKE='1'
pnpm radar:test:google
Remove-Item Env:RADAR_GOOGLE_RSS_SMOKE
```

기본 테스트는 합성 fixture만 사용하고 public smoke는 환경변수를 명시한 단일 실행에서만 네트워크를 사용한다. smoke도 응답을 저장·게시하지 않는다.

검증 항목: entity/숫자 문자, traffic 단위, source/fetch/sample 시각, 재시도 멱등성, 정상 빈 feed, malformed XML, DOCTYPE/ENTITY, 중첩·항목·바이트 상한, redirect/host/content-type, 429/503/timeout/network 오류, 이미 abort된 run, R04 예산·provider request·completion 원장 통합.

2026-09-20 로컬 검증 결과:

- 고정 fixture·HTTP 경계 22개 통과, 별도 공개 KR feed smoke 1개 통과
- PostgreSQL 통합 81개 통과(이 중 Google RSS → R04 실행·요청·예산 원장 연결 1개)
- Radar schema/계약/정책/poll 단위·회귀 106개와 로컬 격리 profile 4개 통과
- API typecheck, 변경 TypeScript ESLint, Prettier, `git diff --check`, localhost web/live/ready 확인 통과

프로덕션 의존성 감사는 저장소 기존 의존성에서 별도 보안 부채를 보고했다. 이 어댑터가 직접 사용하는 parser는 `5.10.1`로 고정되어 있지만 AWS SDK 하위의 `5.2.5`, Next.js, Expo 계열 등 기존 경로는 R05 범위 밖이며 별도 업그레이드 작업이 필요하다. 감사 실패를 R05 통과로 오인하지 않는다.

운영 배포는 사용자 요청 때 별도 진행한다. 다음 R06은 실제 Naver 계정 권한을 활성화하지 않은 채 검색·DataLab adapter의 fixture/mock 경계를 구현한다.

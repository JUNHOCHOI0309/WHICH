# Search Discovery Launch Checklist

Updated: 2026-08-29

## 1. Post-deploy smoke checks

배포 완료 후 브라우저 화면이 아니라 raw HTTP 응답으로 확인한다.

```bash
curl -I https://whichone.site/robots.txt
curl -I https://whichone.site/sitemap.xml
curl -I https://whichone.site/feed.xml
curl -s https://whichone.site/robots.txt
curl -s https://whichone.site/sitemap.xml
curl -s https://whichone.site/issues/ISSUE_UUID
```

Issue HTML에서 확인할 항목:

- 질문 문장과 A/B 선택지 문구가 raw HTML에 있다.
- canonical이 `https://whichone.site/issues/{uuid}`다.
- 일반 URL description에 결과 퍼센트와 댓글이 없다.
- `?utm_source=google&utm_medium=organic` 또는 `?share=...` 변형은 `noindex,follow`다.
- 존재하지 않는 UUID는 404다.
- `/me`, `/login`, `/ops`, `/api/*` 응답에 noindex 정책이 있다.

## 2. Webmaster registration

외부 콘솔 작업은 코드 배포와 별도로 운영자가 수행한다.

### Google Search Console

1. `whichone.site` Domain property를 DNS TXT로 확인한다.
2. `https://whichone.site/sitemap.xml`을 제출한다.
3. 홈과 대표 Issue 3~5개를 URL Inspection으로 검사한다.
4. rendered HTML에서 질문·선택지가 보이는지 확인한다.

### Naver Search Advisor

1. 사이트 소유권을 확인한다.
2. sitemap과 Atom feed를 제출한다.
3. robots 수집 가능 여부와 대표 Issue 응답을 검사한다.

### Bing Webmaster Tools

1. 사이트를 등록하거나 Search Console property를 가져온다.
2. sitemap을 제출한다.
3. Crawl Control과 URL Inspection 결과를 기록한다.

## 3. Cloudflare / WAF

- `/ops`는 Cloudflare Access 보호를 유지한다.
- `/`, `/issues/*`, `/user/*`, trust/legal pages, `/robots.txt`, `/sitemap.xml`, `/feed.xml`, OG image route는 Access 뒤에 두지 않는다.
- verified Googlebot, Bingbot, Naver Yeti, `OAI-SearchBot` 요청에 Managed Challenge가 걸리지 않는지 확인한다.
- User-Agent 문자열만 믿어 광범위하게 우회하지 말고 Cloudflare verified bot 신호와 공급자 공식 검증 방식을 사용한다.
- `GPTBot` 차단은 의도된 정책이다. 검색 노출용 `OAI-SearchBot`과 혼동하지 않는다.

## 4. Measurement validation

배포 후 테스트 유입 URL:

```text
https://whichone.site/issues/ISSUE_UUID?utm_source=google&utm_medium=organic&utm_campaign=seo_smoke
https://whichone.site/issues/ISSUE_UUID?utm_source=chatgpt&utm_medium=ai_referral&utm_campaign=geo_smoke
```

선택 또는 다른 analytics event를 발생시킨 뒤 운영 analytics에서 다음 coarse pair가 보이는지 확인한다.

- `google / organic`
- `chatgpt / ai_referral`

원본 Referrer path/query와 검색어는 저장되면 안 된다. 이 버전은 raw 방문·bounce가 아니라 기존 event가 발생한 qualified acquisition만 센다.

## 5. Weekly review

- valid indexed pages / submitted pages
- excluded page reason: canonical, noindex, soft 404, crawled-not-indexed
- sitemap read failures and API fallback frequency
- organic and AI-referral qualified sessions
- first vote conversion, second vote conversion, next Issue open rate by acquisition pair
- duplicate/thin Issue excluded count
- crawl 4xx/5xx and OG image errors

색인 숫자가 줄었더라도 private, tracked, thin URL이 빠진 결과라면 품질 개선일 수 있다. 전체 수보다 canonical 공개 Issue의 유효 색인 비율을 우선한다.

## 6. Rollback

문제가 생기면 다음 순서로 범위를 줄인다.

1. sitemap에서 dynamic Issue 항목을 제외하고 static trust routes만 유지한다.
2. Issue metadata를 `noindex,follow`로 임시 전환한다.
3. SSR initial data 전달은 유지하되 crawler 노출만 닫는다.
4. attribution referrer classifier를 비활성화하고 기존 Naver/Share UTM만 유지한다.

robots에서 공개 URL을 즉시 차단하면 이미 색인된 URL의 noindex 확인 자체를 방해할 수 있으므로, 삭제 목적에는 페이지 `noindex`를 먼저 사용한다.

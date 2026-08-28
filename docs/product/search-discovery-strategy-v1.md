# WHICH Search Discovery Strategy v1

Status: Implemented foundation / controlled rollout  
Updated: 2026-08-29  
Source reviewed: `WHICH_SEO_AEO_GEO_STRATEGY_V1_2026-08-28.md`

## Objective

WHICH의 공개 질문을 검색엔진과 AI 검색 서비스가 정확히 읽고 인용할 수 있게 하되, 제품의 핵심 원칙인 **선택 전 결과 비공개**와 개인 기록 비공개를 훼손하지 않는다.

이 문서에서 “노출”은 크롤링 가능성과 검색 이해도를 높인다는 뜻이다. 순위, 색인 시점, AI 답변 채택은 외부 시스템의 판단이므로 보장하지 않는다.

## Implemented foundation

### Crawl and index control

- `robots.txt`를 코드로 생성한다.
- Google, Bing, Naver 등 일반 검색 봇과 `OAI-SearchBot`은 공개 페이지를 읽을 수 있다.
- 모델 학습용 `GPTBot`은 검색 노출 봇과 분리해 차단한다.
- `/api`, `/ops`, `/me`, 인증·가입·복구, 질문 작성, 관심사 설정 화면은 robots와 `X-Robots-Tag`에서 제외한다.
- `sitemap.xml`은 신뢰 문서와 현재 공개 피드의 canonical Issue URL만 포함한다.
- `feed.xml`은 최신 공개 질문 50개를 Atom 형식으로 제공한다.

### Canonical and metadata

- 홈페이지, Issue, 공개 작성자 프로필, 법률·신뢰 문서에 self-canonical을 지정한다.
- `?share=`, `utm_*`, `gclid`, `fbclid`가 붙은 Issue는 원본 Issue로 canonical 처리하고 `noindex,follow`로 둔다.
- Issue 제목, 맥락, 선택지를 이용해 페이지별 고유 description을 생성한다.
- 선택 전 일반 metadata에는 결과 비율과 댓글을 넣지 않는다.
- 유효한 현재 버전 Share Card만 소셜 공유 미리보기에서 결과를 사용할 수 있다. 종료·중지·구버전 Share Card는 결과 metadata를 만들지 않는다.

### Server-rendered public content

- Issue 페이지 최초 HTML에 질문, 맥락, A/B 선택지 문구가 포함된다.
- SSR 중 Guest를 새로 만들지 않는다. 브라우저에서 Guest 준비와 기존 투표 복원을 마칠 때까지 선택 버튼을 잠근다.
- 존재하지 않는 UUID 또는 공개 Issue 404는 서버 404로 처리해 soft-404를 줄인다.
- 공개 작성자 프로필도 서버에서 초기 데이터를 읽어 이름, 소개, 공개 질문을 최초 HTML에 포함한다.

### Social preview and structured data

- 홈페이지와 각 Issue에 1200×630 Open Graph 이미지를 생성한다.
- Issue OG는 질문과 선택지만 보여주며 결과는 숨긴다.
- 홈페이지는 `Organization`과 `WebSite`, Issue는 `WebPage`와 `BreadcrumbList`, 공개 작성자는 `ProfilePage`와 `Person` JSON-LD를 제공한다.
- JSON-LD는 `<`를 escape해 script 문맥 삽입을 막는다.

### Trust surfaces

다음 공개 문서를 canonical·sitemap·footer에 연결한다.

- `/about`
- `/methodology`
- `/editorial-policy`
- `/vote-integrity`
- `/moderation-policy`
- `/corrections`
- `/legal/terms`
- `/legal/privacy`

투표 결과가 자발적 참여자의 서비스 내 스냅샷이며 대표 표본 조사가 아니라는 한계를 명시한다.

### Search and AI acquisition attribution

원본 Referrer URL, 검색어, 경로, query를 저장하지 않고 allowlist hostname을 다음과 같은 낮은 해상도 값으로 변환한다.

- Search: `naver|google|bing|daum / organic`
- AI referral: `chatgpt|perplexity|claude|gemini|copilot / ai_referral`
- 기존 Naver campaign과 Share attribution은 유지한다.

30일 first-touch cookie가 이미 있으면 덮어쓰지 않는다. 현재 지표는 raw landing 수가 아니라 기존 Issue analytics event가 발생한 **engaged/qualified acquisition**만 측정한다.

## Search-safe content policy

Index 후보 Issue는 다음 조건을 만족해야 한다.

1. 현재 공개 API에서 참여 가능한 Issue로 반환된다.
2. 질문이 최소한의 설명력을 가진다.
3. 두 개 이상의 비어 있지 않은 선택지가 있으며 선택지 문구가 서로 다르다.
4. URL은 clean canonical이다.

검색 HTML과 일반 metadata에 포함 가능한 항목:

- 질문
- 질문 맥락
- 선택지 문구
- 카테고리
- 공개 작성자 정보

일반 검색 HTML·metadata에서 제외하는 항목:

- 선택 전 결과 수치
- 댓글 본문과 대표 댓글
- 개인 선택 기록
- Guest/Member/session 식별자
- 운영 위험 점수와 비공개 검수 정보

## Deferred expansion backlog

### P1 — after production observation

- `WHICH-SEO-02`: immutable human-readable slug 저장과 UUID URL 301 redirect
- `WHICH-SEO-03`: 주제 허브 (`/topics/{slug}`)와 topic taxonomy landing
- `WHICH-SEO-04`: 종료 Issue의 evergreen archive sitemap API
- `WHICH-SEO-05`: IndexNow outbox publisher and retry ledger
- `WHICH-SEO-06`: 공개 작성자 sitemap source API
- `WHICH-SEO-07`: Issue 수정 시 `dateModified`, correction note, structured revision history
- `WHICH-SEO-08`: AI answer-friendly, evidence-backed insight snapshot (no unsupported synthesis)

### P2 — after enough data

- Search/AEO landing impression fact separate from 30-day acquisition cookie
- search query cluster → Issue supply gap report
- indexed-page quality score and automatic sitemap exclusion
- source/medium assisted-conversion model
- topic authority and internal-link graph optimization

## Non-goals

- 검색 봇에만 결과를 보여주는 cloaking
- 질문마다 얇은 키워드 변형 페이지를 대량 생성하는 것
- 공개 API에 없는 결과·댓글·운영 판단을 SSR에서 우회 노출하는 것
- 외부 Referrer 원문이나 검색어를 analytics에 저장하는 것
- 검색 순위 또는 AI 인용을 제품에서 보장하는 것

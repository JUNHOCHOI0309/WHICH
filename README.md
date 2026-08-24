# WHICH

WHICH는 질문, A/B 선택, 결과, 다음 이슈로 이어지는 모바일 우선 의견 소비 제품입니다.
현재 저장소는 초기 Platform Foundation 단계를 지나 Guest·Member 핵심 흐름을 구현했으며,
Public v0 Release Candidate의 콘텐츠·측정·운영 준비도를 검증하는 단계입니다.

구현 완료 범위, 출시 전 남은 Gate, Post-v0 비범위는
[`docs/product/public-v0-release-scope.md`](docs/product/public-v0-release-scope.md)를 기준으로 관리합니다.
Trending 질문, 고품질 Feed 추천, Fine-tuned AI 보조 구조는
[`docs/product/post-v0-discovery-recommendation-ai-roadmap.md`](docs/product/post-v0-discovery-recommendation-ai-roadmap.md)에
후속 작업으로 분리해 두었습니다.

## 기술 기반

- pnpm + Turborepo 모노레포
- Next.js App Router 웹 (`apps/web`)
- Expo/React Native Android·iOS 앱 (`apps/mobile`)
- Fastify API와 OpenAPI 문서 (`apps/api`)
- PostgreSQL + Drizzle 마이그레이션 기반
- Docker Compose 로컬 인프라
- Vitest, ESLint, Prettier, GitHub Actions

결정 배경과 교체 경계는
[`docs/architecture/adr/0001-platform-foundation.md`](docs/architecture/adr/0001-platform-foundation.md)에
기록되어 있습니다.
네이티브 모바일 확장 결정은
[`docs/architecture/adr/0002-native-mobile-client.md`](docs/architecture/adr/0002-native-mobile-client.md)를
확인하세요.

## 요구 환경

- Node.js 22.14.x
- pnpm 10.6.x
- Docker Desktop 또는 Docker Engine + Compose

## 시작하기

```bash
corepack enable
pnpm install
copy .env.example .env
copy apps/web/.env.example apps/web/.env.local
pnpm infra:up
pnpm --filter @which/api db:migrate
pnpm --filter @which/api db:seed
pnpm dev
```

PowerShell에서는 `Copy-Item .env.example .env`와
`Copy-Item apps/web/.env.example apps/web/.env.local`을 사용할 수 있습니다. OAuth 환경 변수와
Callback 설정은 [`docs/development/social-auth-setup.md`](docs/development/social-auth-setup.md)를
확인하세요.

- 웹: <http://localhost:3000>
- 공개 질문 Feed: <http://localhost:3000>
- 개발 질문 직접 참여: <http://localhost:3000/issues/10000000-0000-4000-8000-000000000001>
- API live check: <http://localhost:4000/health/live>
- API readiness: <http://localhost:4000/health/ready>
- OpenAPI UI: <http://localhost:4000/docs>
- PostgreSQL: `localhost:54329` (기존 로컬 PostgreSQL 기본 포트와 충돌 방지)

Expo 앱은 별도 터미널에서 실행합니다.

```bash
pnpm --filter @which/mobile start
```

실기기에서 Local Web BFF에 접근할 때는 `apps/mobile/.env.local`의
`EXPO_PUBLIC_API_BASE_URL`을 개발 PC의 LAN 주소로 설정합니다. 자세한 경계는
[`docs/product/native-mobile-foundation.md`](docs/product/native-mobile-foundation.md)를 확인하세요.

PostgreSQL 없이도 API 프로세스와 live check는 실행됩니다. readiness는 데이터베이스 연결이
없으면 의도대로 `503`을 반환합니다.

## 주요 명령

```bash
pnpm dev          # 웹과 API 개발 서버
pnpm check        # 포맷, 린트, 타입, 테스트, 프로덕션 빌드
pnpm infra:up     # PostgreSQL 시작
pnpm infra:down   # 컨테이너 정지 (데이터 볼륨 유지)
pnpm --filter @which/api db:generate
pnpm --filter @which/api db:migrate
pnpm --filter @which/api db:seed       # 멱등 Development Issue·Comment 생성
pnpm --filter @which/api issues:validate content/issue-packs/which-19-initial-low-v1.json
pnpm --filter @which/api issues:readiness content/issue-packs/public-v0-inventory-policy.json
pnpm --filter @which/api outbox:worker # 독립 Outbox Publisher 실행
pnpm --filter @which/api outbox:publish-once
pnpm --filter @which/api launch:gate # 읽기 전용 Public MVP GO/NO-GO 판정
pnpm --filter @which/api launch:public-smoke https://whichone.site
pnpm --filter @which/api analytics:summary -- 30
pnpm --filter @which/api analytics:retention # 일별 집계 후 90일 초과 원시 Event 정리
pnpm --filter @which/mobile start       # Expo QR과 개발 서버
pnpm --filter @which/mobile typecheck
```

`db:seed`는 Production 환경에서 실행되지 않으며, 여러 번 실행해도 같은 Issue, Choice,
Comment를 중복 생성하거나 기존 Version을 덮어쓰지 않습니다.

## 현재 구현 범위

현재 아래 제품 축이 구현되어 있습니다.

- Guest·Member Feed → Vote → Result → Next와 중복·재시도 보호
- 이메일 계정과 Google·X·Naver·Kakao 로그인, 명시적 계정 연결, 로그아웃과 회원 탈퇴
- 관심사 Profile, `interest_content_v1` 개인화 Ranking, Recency Fallback, 투표 완료 Feed 제외
- Vote 이후 댓글 작성·조회, A/B 대표 댓글, 공감, 신고, 작성자 수정·삭제
- 신고 누적 자동 접기·숨김과 내부 Moderation·Restore 흐름
- 결과 공유와 외부 Deep-link
- 운영 Issue Pack 검증·게시와 Transactional Outbox
- First-party Analytics, Public Smoke, Public MVP Gate, Rollback Drill
- 반응형 Web과 Expo Android·iOS Guest 핵심 흐름
- PostgreSQL Integration Test를 포함한 CI 검증 경로

현재 우선순위는 새 Surface를 추가하는 것이 아니라 Issue Pool, 핵심 Funnel 기준선, 운영 E2E와
제한 사용자 Beta를 순서대로 통과해 Public v0 Go/No-Go를 판단하는 것입니다. 고급 Ranking,
Native Member OAuth·Store 배포, 대규모 Creator·Following·알림, Reply 고도화, Search·Trending·Live는
Beta 결과 이후의 Post-v0 범위입니다.

Outbox Worker 운영 방법은
[`docs/operations/outbox-publisher.md`](docs/operations/outbox-publisher.md), 출시 판정과 복구 훈련은
[`docs/operations/public-mvp-gate-and-rollback.md`](docs/operations/public-mvp-gate-and-rollback.md)를
확인하세요. 운영 Issue Pack 게시 절차는
[`docs/operations/issue-pack-publication.md`](docs/operations/issue-pack-publication.md), 네이버 로그인과
유입 경계는 [`docs/product/naver-acquisition-and-login.md`](docs/product/naver-acquisition-and-login.md)에
기록되어 있습니다. 핵심 지표 정의와 보존·집계 운영은
[`docs/operations/core-analytics.md`](docs/operations/core-analytics.md)를 확인하세요.

# WHICH

WHICH는 질문, A/B 선택, 결과, 다음 이슈로 이어지는 모바일 우선 의견 소비 제품입니다.
현재 저장소에는 Platform Foundation과 Data Architecture v1, Guest 핵심 투표 Transaction,
Guest Comment Read Flow까지 구현되어 있습니다.

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

현재 아래 항목이 구현되어 있습니다.

- 환경 변수 검증
- 기본 비활성 Feature Flag
- API live/readiness 계약
- Data Architecture v1 PostgreSQL Schema와 Migration
- Guest Subject 발급과 멱등 Vote Transaction
- Vote Aggregate, Result Snapshot, Versioned Outbox 기록
- Lease 기반 Outbox Publisher, 지수 백오프, Dead Letter와 재큐잉
- 릴리스 ID 검증, Public MVP Gate와 비파괴 Rollback Drill
- Guest Issue Read API와 Result Visibility 처리
- 반복 가능한 Development Issue Seed
- 안정 Cursor를 사용하는 Guest Issue Feed API
- HttpOnly Guest 식별자를 사용하는 Web BFF
- Provider Subject 기반 Member Identity와 HttpOnly Member Session
- Google·Naver OIDC와 X OAuth 2.0 PKCE Web BFF, Guest → Member Vote 연결
- Expo Android·iOS 공통 앱의 Guest Feed → Issue → Vote → Result 기반
- OS Secure Storage를 사용하는 모바일 Guest Subject
- 서버 비밀정보를 포함하지 않는 `/api/mobile/v1` 공개 BFF
- 모바일 Guest 투표 화면과 투표 후 결과 공개
- 이미 참여한 질문을 제외한 Result → Next Issue 이동
- Issue Version과 작성 당시 A/B 선택을 보존하는 Comment Schema
- 승인된 Vote 이후에만 공개되는 Guest Comment Read API
- Comment 최신순 Cursor Pagination과 전체/A/B Filter
- Result 화면의 Comment 목록, Empty, Error, 추가 조회 상태
- Deep Navy 기반 Cyan–Orange 선택 디자인 시스템
- 중복 제출·네트워크 재시도 시 최초 선택 보호
- 실제 PostgreSQL Integration Test
- 30분 Session, Viewable Impression, 서버 Vote 원장을 결합한 First-party Analytics
- CI 검증 경로

Reply, 개인화 Feed Ranking, 강화된 Integrity Challenge와 추천 모델은 후속 Task에서 구현합니다.
Outbox Worker 운영 방법은
[`docs/operations/outbox-publisher.md`](docs/operations/outbox-publisher.md), 출시 판정과 복구 훈련은
[`docs/operations/public-mvp-gate-and-rollback.md`](docs/operations/public-mvp-gate-and-rollback.md)를
확인하세요. 운영 Issue Pack 게시 절차는
[`docs/operations/issue-pack-publication.md`](docs/operations/issue-pack-publication.md), 네이버 로그인과
유입 경계는 [`docs/product/naver-acquisition-and-login.md`](docs/product/naver-acquisition-and-login.md)에
기록되어 있습니다. 핵심 지표 정의와 보존·집계 운영은
[`docs/operations/core-analytics.md`](docs/operations/core-analytics.md)를 확인하세요.

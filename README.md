# WHICH

WHICH는 질문, A/B 선택, 결과, 다음 이슈로 이어지는 모바일 우선 의견 소비 제품입니다.
현재 저장소에는 Platform Foundation과 Data Architecture v1, Guest 핵심 투표 Transaction,
Guest Issue Read API까지 구현되어 있습니다.

## 기술 기반

- pnpm + Turborepo 모노레포
- Next.js App Router 웹 (`apps/web`)
- Fastify API와 OpenAPI 문서 (`apps/api`)
- PostgreSQL + Drizzle 마이그레이션 기반
- Docker Compose 로컬 인프라
- Vitest, ESLint, Prettier, GitHub Actions

결정 배경과 교체 경계는
[`docs/architecture/adr/0001-platform-foundation.md`](docs/architecture/adr/0001-platform-foundation.md)에
기록되어 있습니다.

## 요구 환경

- Node.js 22.14.x
- pnpm 10.6.x
- Docker Desktop 또는 Docker Engine + Compose

## 시작하기

```bash
corepack enable
pnpm install
copy .env.example .env
pnpm infra:up
pnpm --filter @which/api db:migrate
pnpm --filter @which/api db:seed
pnpm dev
```

PowerShell에서는 환경 파일 복사에 `Copy-Item .env.example .env`를 사용할 수 있습니다.

- 웹: <http://localhost:3000>
- API live check: <http://localhost:4000/health/live>
- API readiness: <http://localhost:4000/health/ready>
- OpenAPI UI: <http://localhost:4000/docs>
- PostgreSQL: `localhost:54329` (기존 로컬 PostgreSQL 기본 포트와 충돌 방지)

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
pnpm --filter @which/api db:seed       # 멱등 Development Issue 생성
```

`db:seed`는 Production 환경에서 실행되지 않으며, 여러 번 실행해도 같은 Issue나 Choice를
중복 생성하거나 기존 Version을 덮어쓰지 않습니다.

## 현재 구현 범위

현재 아래 항목이 구현되어 있습니다.

- 환경 변수 검증
- 기본 비활성 Feature Flag
- API live/readiness 계약
- Data Architecture v1 PostgreSQL Schema와 Migration
- Guest Subject 발급과 멱등 Vote Transaction
- Vote Aggregate, Result Snapshot, Versioned Outbox 기록
- Guest Issue Read API와 Result Visibility 처리
- 반복 가능한 Development Issue Seed
- 실제 PostgreSQL Integration Test
- CI 검증 경로

Feed Ranking, Web 투표 화면, 회원 인증, 강화된 Integrity Challenge, Comment와 추천 모델은
후속 Task에서 구현합니다.

# WHICH

WHICH는 질문, A/B 선택, 결과, 다음 이슈로 이어지는 모바일 우선 의견 소비 제품입니다.
이 저장소는 상세 기획의 Phase 1(`Data Contract & Platform Foundation`)을 시작하기 위한
개발 기반만 포함합니다. 도메인 스키마와 제품 기능은 Data Architecture v1 승인 뒤 추가합니다.

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
```

## 구현 경계

현재는 아래 항목만 준비되어 있습니다.

- 환경 변수 검증
- 기본 비활성 Feature Flag
- API live/readiness 계약
- 빈 Drizzle schema entrypoint와 migration directory
- CI 검증 경로

Issue, Choice, Subject, Vote, Result 등의 테이블·API는 논리 ERD, 불변조건, 보존 정책이
확정되기 전 추가하지 않습니다.

# ADR-0001: Platform foundation

- Status: Accepted
- Date: 2026-08-18
- Closes: `OD-P0-012`
- Related: `DEC-RM-006`, `DEC-RM-008`

## Context

WHICH는 모바일 외부 링크에서 시작하는 Guest 투표, 결과 집계, 다음 Issue, 운영자 콘텐츠
공급, 이벤트 분석, 추후 ML v0를 함께 지원해야 합니다. 반면 최종 클라우드 제공자, 물리 DB
스키마, ML v1은 아직 결정 대상이 아닙니다. 초기 기술 선택은 R1 프로토타입 속도를 확보하면서
Vote 무결성, Audit, Feature Flag, 향후 서비스 분리 가능성을 보존해야 합니다.

## Decision

1. 저장소는 pnpm workspace와 Turborepo를 사용하는 모노레포로 구성한다.
2. 사용자 웹은 Next.js App Router와 React, TypeScript를 사용한다.
3. API는 Fastify 기반 TypeScript 모듈러 모놀리스로 시작한다.
4. 운영 데이터의 Source of Truth는 PostgreSQL로 두고, Drizzle로 명시적 SQL migration을
   관리한다.
5. API 계약은 JSON Schema/OpenAPI로 노출한다.
6. 로컬 인프라는 Docker Compose로 제공하되 Production 배포 사업자는 고정하지 않는다.
7. 추천·비동기 작업은 초기 API와 DB 계약을 공유하는 Worker 경계로 설계하고, Python 전용
   서비스는 ML v0 benchmark에서 필요성이 확인될 때 추가한다.
8. 정치 투표와 정치 댓글은 환경 설정으로도 켤 수 없는 코드 수준의 기본 `false`로 둔다.

## Why this fits the product contract

- Next.js는 독립 Issue URL, 모바일 우선 렌더링, 공유·검색 진입을 지원한다.
- Fastify의 schema 기반 validation과 serialization은 Vote/Event 계약을 한곳에서 검증하기
  적합하다.
- PostgreSQL transaction과 unique constraint는 Subject별 Accepted Vote 1개와 idempotency를
  DB 수준에서 보장할 수 있다.
- 모듈러 모놀리스는 초기 운영 복잡도를 낮추면서 Vote, Editorial, Moderation, Analytics
  경계를 코드에서 유지할 수 있다.

## Consequences

- 웹과 API는 독립 프로세스이므로 CORS, API versioning, 배포 관측이 필요하다.
- DB schema는 TypeScript 코드만 수정해서는 안 되며 migration review가 필수다.
- pnpm, Node.js, PostgreSQL의 기준 버전을 의도적으로 관리해야 한다.
- Data Architecture v1 전에는 도메인 테이블을 만들지 않는다.

## Revisit triggers

- R4 외부 유입에서 서버 렌더링 또는 API latency budget을 지속적으로 위반한다.
- ML v0 embedding pipeline이 Node worker로 운영 불가능하다는 benchmark 결과가 나온다.
- 특정 클라우드의 배포·보안 요구가 현재 container boundary와 호환되지 않는다.
- 단일 PostgreSQL의 확장 한계가 측정 데이터로 확인된다.

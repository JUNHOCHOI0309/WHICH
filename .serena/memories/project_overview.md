# WHICH project overview

- Product: mobile-first binary-opinion content feed
- Core loop: direct Issue URL → Guest vote → Result → Next Issue
- Architecture: Next.js web + Fastify modular monolith API + PostgreSQL
- Repository: pnpm/Turborepo TypeScript monorepo
- Data rule: the server owns vote writes; clients never write Vote rows directly
- Completed baseline: platform foundation and Data Architecture v1
- Current next task: Core Vote Transaction & HTTP API v1
- Primary architecture records: `docs/architecture/adr/0001-platform-foundation.md` and `docs/architecture/data-architecture-v1.md`
- Product source documents: `WHICH_PLANNING_V2_REVISIONS/`

Before implementing a domain feature, identify its Decision IDs, invariants, event contract, and rollback behavior. For vote work, read `mem:data_architecture_v1`.
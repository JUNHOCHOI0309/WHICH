# WHICH project overview

- Product: mobile-first binary-opinion content feed
- Core loop: direct Issue URL → Guest vote → Result → Next Issue
- Architecture: Next.js web + Fastify modular monolith API + PostgreSQL
- Repository: pnpm/Turborepo TypeScript monorepo
- Data rule: the server owns vote writes; clients never write Vote rows directly
- Current phase: platform foundation before Data Architecture v1 and domain schema
- Primary architecture record: `docs/architecture/adr/0001-platform-foundation.md`
- Product source documents: `WHICH_PLANNING_V2_REVISIONS/`

Before implementing a domain feature, identify its Decision IDs, invariants, event contract, and
rollback behavior.

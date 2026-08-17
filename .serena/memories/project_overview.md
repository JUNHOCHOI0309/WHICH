# WHICH project overview

- Product: mobile-first binary-opinion content feed
- Core loop: direct Issue URL → Guest vote → Result → Comment → Next Issue
- Architecture: Next.js web + Fastify modular monolith API + PostgreSQL
- Repository: pnpm/Turborepo TypeScript monorepo
- Data rule: the server owns vote writes; clients never write Vote rows directly
- Completed baseline: platform foundation, Data Architecture v1, Core Vote Transaction v1, Issue Read API & Development Seed v1, Web Guest Vote Flow v1, Feed & Next Issue Navigation v1, and Comment Data Architecture & Guest Read Flow v1
- Current next task: decide the Member identity and Comment authoring boundary before enabling writes
- Primary architecture records: `docs/architecture/adr/0001-platform-foundation.md` and `docs/architecture/data-architecture-v1.md`
- Product source documents: `WHICH_PLANNING_V2_REVISIONS/`

Before implementing a domain feature, identify its Decision IDs, invariants, event contract, and rollback behavior. For vote, feed, and Comment work, read `mem:data_architecture_v1`, `mem:core_vote_transaction_v1`, `mem:issue_read_seed_v1`, `mem:web_guest_vote_flow_v1`, `mem:feed_next_issue_navigation_v1`, and `mem:comment_data_read_flow_v1`.

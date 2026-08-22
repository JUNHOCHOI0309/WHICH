# ADR-0002: Native mobile client strategy

- Status: Accepted
- Date: 2026-08-20
- Extends: ADR-0001
- Related: DEC-UX-009, WHICH-22

## Context

ADR-0001 selected a mobile-first Next.js surface because an external Issue link must open without
an installation or sign-up barrier. That decision remains valid for acquisition. WHICH is also a
vertical, repeat-consumption product, so the primary returning-user environment is expected to be
Android and iOS rather than desktop.

The repository currently has no installable PWA or native project. Browser cookies also cannot be
treated as the long-term session contract for a native client.

## Decision

1. Keep the responsive Web app as the canonical external deep-link and search surface.
2. Add an Expo/React Native app as the preferred returning-user client for Android and iOS.
3. Deliver the native client in three independently gated phases:
   - Phase 1: Guest Feed, Issue, Vote, Result, error recovery.
   - Phase 2: Google, X, Naver, and Kakao system-browser OAuth with App/Universal Links.
   - Phase 3: Push, store distribution, crash/performance observability.
4. Keep Vote Facts, Result Aggregates, policy decisions, and identity links in the existing Fastify
   API and PostgreSQL Source of Truth.
5. Add a public mobile BFF under `whichone.site/api/mobile/v1`. It may expose only public product
   contracts and must never embed `INTERNAL_AUTH_SECRET` or provider Client Secrets in the app.
6. Store the native Guest Subject and future Member Session in OS secure storage. Web development
   may use a clearly documented non-production fallback.

## Why Expo

- The team can reuse TypeScript, React knowledge, domain contracts, and test tooling.
- One project supports Android and iOS while preserving platform-specific escape hatches.
- Router, system-browser authentication, deep links, secure storage, and later push notifications
  have supported Expo paths.
- React Native UI avoids making the long-term app a remote WebView wrapper.

## Security and integrity consequences

- A mobile installation is an Anonymous Subject boundary, not proof of one human.
- Client-provided Guest Subject and Idempotency values remain untrusted input validated by the API.
- Losing or clearing Secure Storage creates a new Guest Subject; Member login remains the supported
  merge path across installations.
- OAuth code exchange and provider secrets stay on the server. The app receives only a bounded
  mobile session after a verified callback in Phase 2.
- Offline Vote acceptance is prohibited. A failed request must be retried with the same Idempotency
  Key and reconciled by the server.

## Alternatives considered

### PWA only

Useful as an installability step, but insufficient as the only path for native deep links, secure
session storage, push, and store distribution.

### Capacitor or remote WebView wrapper

Faster for visual reuse, but it keeps the server-rendered Web surface as the app runtime and makes
the long-term OAuth, navigation, and native interaction boundary less explicit.

### Separate Swift and Kotlin apps

Offers maximum platform control but doubles the first implementation and maintenance burden before
the product has measured platform-specific needs.

## Revisit triggers

- React Native cannot meet measured gesture, accessibility, or performance budgets.
- Provider OAuth policies require a platform-native SDK that Expo cannot integrate safely.
- Android and iOS behavior diverges enough to justify dedicated platform modules or applications.
- The public mobile BFF becomes a scaling or security boundary that needs a dedicated gateway.

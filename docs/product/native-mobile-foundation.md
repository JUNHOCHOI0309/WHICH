# WHICH Native Mobile Foundation

WHICH uses two complementary mobile surfaces:

- **Mobile Web:** external links, search, sharing, and an installation-free first Vote.
- **Expo app:** returning Feed consumption, native navigation, and later OAuth/Push capabilities.

The first native release is intentionally Guest-only. It proves the same Core Vote Loop already
protected by the production API and PostgreSQL before adding mobile provider credentials.

## Current Phase 1 flow

```text
Expo app
  -> POST /api/mobile/v1/guest-subjects
  -> Guest Subject in iOS Keychain / Android Keystore
  -> GET /api/mobile/v1/issues/feed
  -> GET /api/mobile/v1/issues/{issueId}
  -> POST /api/mobile/v1/issues/{issueId}/votes
  -> Accepted Vote + Result Aggregate
```

The app never receives Render internal credentials. The public Next.js BFF forwards bounded
requests to the loopback Fastify API, and the database remains the Vote Source of Truth.

## Local run

Install dependencies and start the API, Web BFF, and PostgreSQL as usual:

```powershell
pnpm install
pnpm infra:up
pnpm --filter @which/api db:migrate
pnpm --filter @which/api db:seed
pnpm dev
```

In another terminal, start Expo:

```powershell
pnpm --filter @which/mobile start
```

The app defaults to the production BFF at `https://whichone.site`. To test against a local computer
from a physical phone, copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and replace the
host with the computer's LAN address, for example:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:3000
```

`localhost` on a physical phone refers to the phone itself. The phone and development computer must
be able to reach each other on the selected network.

## Validation commands

```powershell
pnpm --filter @which/mobile typecheck
pnpm --filter @which/mobile lint
pnpm --filter @which/mobile test
pnpm --filter @which/mobile build
```

The `build` command exports the Web target as a CI bundle check. Android/iOS signed binaries belong
to the later EAS/store distribution gate.

## Guest Subject and retry contract

- iOS and Android store the UUID using `expo-secure-store`.
- Web-only Expo development falls back to browser local storage and is not a production credential
  contract.
- A missing or unknown Subject is replaced through the public BFF.
- One user action owns one Idempotency Key. Network retry and Subject rotation reuse that key.
- The app never increments a result locally; it renders the server response.

## Phase 2: native identity

Google, X, Naver, and Kakao mobile login is deliberately not a Web cookie reuse exercise. Phase 2 must add:

1. System-browser Authorization Code + PKCE.
2. Provider-specific mobile Redirect URI registrations.
3. App Link/Universal Link or verified custom scheme return.
4. Server-side code exchange and a bounded mobile Member Session.
5. Keychain/Keystore session storage, revocation, rotation, and logout.
6. Guest-to-Member linking using the existing identity transaction.

Provider Client Secrets and `INTERNAL_AUTH_SECRET` are server-only and prohibited in the app bundle.

## Phase 3: distribution

- Android application ID and Play Internal Testing.
- iOS bundle identifier and TestFlight.
- App icon, splash, privacy disclosures, store screenshots, and review notes.
- Crash reports, startup timing, network error rate, and Accepted Vote funnel by platform.
- Push permission only after the user has received product value.

# Render Deployment

Status: Prepared for the first production deployment

Platform: Render Singapore + Cloudflare

## Topology

```text
Browser
  -> Cloudflare (whichone.site)
  -> which-web (one Render Starter Web Service)
       -> Next.js public listener ($PORT)
       -> Fastify API loopback listener (127.0.0.1:4000)
  -> which-db (Render Postgres)
```

The cost-optimized MVP runs Next.js and Fastify in one always-on instance.
Only Next.js binds to Render's public port. The Web BFF reaches Fastify over
loopback, so the API is not directly reachable from the internet. This saves one
Starter instance while preserving the Web BFF boundary. The tradeoff is that Web
and API deploy and restart together.

## Expected baseline cost

- `which-web`: one Starter instance, USD 7/month.
- `which-db`: selected Postgres instance plus storage.
- Expected total with Basic-256 MB Postgres: approximately USD 14.50/month with
  5 GB storage or USD 17.50/month with 15 GB storage, before tax and overages.

## One-time Render setup

1. Keep `which-db` in the production project/environment in Singapore.
2. Remove the `0.0.0.0/0` Postgres inbound rule unless temporary, tightly scoped
   workstation access is required. The app uses the internal database URL.
3. In Render, create or resync a Blueprint from the repository's root
   `render.yaml` and select the same project/environment as `which-db`.
4. Confirm that the estimate contains only one Starter service named `which-web`.
5. Supply the Google, X, Naver, and Kakao OAuth/OIDC client IDs and secrets when Render
   prompts for them. These values are not committed. Naver production credentials and
   callback were verified in WHICH-20, so `FEATURE_NAVER_LOGIN_ENABLED=true` exposes it.
   Keep `FEATURE_KAKAO_LOGIN_ENABLED=false` until the Kakao app, callback, credentials,
   and real-account QA are complete.
6. Deploy the Blueprint. The service runs database migrations before accepting a
   new release.

The Blueprint generates the API moderation/internal-auth secrets and the Web
OAuth-flow secret. The Web BFF reads the generated `INTERNAL_AUTH_SECRET`, so a
second manually synchronized secret is not required.

## Domain and OAuth

After `which-web` is healthy at its `onrender.com` address:

1. Add `whichone.site` under `which-web` **Custom Domains**.
2. In Cloudflare DNS, add the root and `www` CNAME records requested by Render.
   Start with **DNS only** while Render verifies the domain and issues its TLS
   certificate. Remove any conflicting `AAAA` records.
3. Once Render shows a valid certificate, enable Cloudflare proxying and use
   Full (strict) TLS.
4. Set the Google authorized redirect URI to
   `https://whichone.site/api/auth/google/callback`.
5. Set the X OAuth 2.0 callback URI to
   `https://whichone.site/api/auth/x/callback`.
6. Set the Naver OIDC callback URI to
   `https://whichone.site/api/auth/naver/callback` and the Naver service URL to
   `https://whichone.site`.
7. In Kakao Developers, enable Kakao Login and OpenID Connect, then register
   `https://whichone.site/api/auth/kakao/callback` for the REST API key and enable
   its Client Secret.

`whichone.site` is the canonical origin. Do not add a second origin to
`AUTH_BASE_URL` or `WEB_ORIGIN` without updating every OAuth/OIDC provider and testing
the session cookies.

## First-release verification

1. From a workstation, run
   `pnpm --filter @which/api launch:public-smoke https://whichone.site`.
2. Publish at least one production Issue and set `LAUNCH_GATE_ISSUE_ID` to a
   stable LOW-risk Issue Version used for reconciliation Dry Run.
   Use the reviewed procedure in `docs/operations/issue-pack-publication.md`;
   do not run the development Seed or direct SQL against production.
3. From a Render Shell, run
   `pnpm --filter @which/api launch:gate artifacts/public-mvp-gate.json`.
   `RENDER_GIT_COMMIT` supplies the expected Release ID automatically, and the
   API is inspected over `http://127.0.0.1:4000`.
4. Confirm Issue -> Vote -> Result -> Comment -> Report with a dedicated test
   account.
5. Copy the secret-free Gate report to the release record.

As of the 2026-08-20 v1.1 verification, the canonical home and Google OAuth
start pass, but the public Feed contains zero launchable Issues. This correctly
keeps the public result at `NO_GO` until production content is published.

## Outbox boundary

Do not deploy `which-outbox-worker` yet. The current worker requires a real HTTP
consumer with signature verification and event-id idempotency. The Blueprint
therefore declares `LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED=false`: Pending Events
remain durable and the Gate reports `DEFERRED`, while any Dead Letter still
returns `NO_GO`. Change the value to `true` only when a real consumer, URL, and
secret are configured.

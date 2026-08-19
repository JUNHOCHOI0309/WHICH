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
5. Supply the existing Google OAuth client ID and secret when Render prompts for
   them. These values are not committed.
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

`whichone.site` is the canonical origin. Do not add a second origin to
`AUTH_BASE_URL` or `WEB_ORIGIN` without updating Google OAuth and testing the
session cookies.

## First-release verification

1. Check `https://whichone.site` and the Google login flow.
2. Confirm Issue -> Vote -> Result -> Comment -> Report with a dedicated test
   account.
3. Run the Public MVP Gate from a Render shell or one-off job after configuring
   its explicit release, issue, and Outbox consumer values. The Gate remains
   read-only.

## Outbox boundary

Do not deploy `which-outbox-worker` yet. The current worker requires a real
HTTP consumer with signature verification and event-id idempotency. A placeholder
webhook would leave pending Events or create Dead Letters, which makes the launch
Gate return `NO_GO`.

# Render Deployment

Status: Prepared for the first production deployment

Platform: Render Singapore + Cloudflare

## Topology

```text
Browser
  -> Cloudflare (whichone.site)
  -> which-web (Render Web Service)
  -> which-api (Render Private Service)
  -> which-db (Render Postgres)
```

`which-api` has no public hostname. The Next.js Web BFF uses Render private
networking to reach it. The API keeps the Vote and Outbox write path away from
direct browser access. The private API explicitly listens on port `4000` because
Render reserves port `10000` for private-network traffic.

## One-time Render setup

1. Keep `which-db` in the `which-production` project/environment in Singapore.
2. Remove the `0.0.0.0/0` Postgres inbound rule unless temporary, tightly scoped
   workstation access is required. Render services use the internal database URL.
3. In Render, create a Blueprint from the repository's root `render.yaml` and
   select the same project/environment as `which-db`.
4. During the Blueprint flow, supply the existing Google OAuth client ID and
   secret when Render prompts for them. These values are not committed.
5. Confirm that `which-api` and `which-web` are both in Singapore before the
   first deploy. `which-api` runs migrations before it accepts a new release.

The Blueprint generates API moderation/auth secrets and separately generates the
Web OAuth-flow secret. `AUTH_INTERNAL_SECRET` is securely copied from the API's
generated `INTERNAL_AUTH_SECRET`; do not replace it with an unrelated value.

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

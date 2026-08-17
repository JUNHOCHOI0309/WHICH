# Web Guest Vote Flow v1

## Route and boundary

- `/` redirects to the stable Development Issue at
  `/issues/10000000-0000-4000-8000-000000000001` until a Feed exists.
- The browser talks only to Next.js Route Handlers under `/api`; the BFF owns API origin details and
  the Guest Subject credential.
- `which_guest_subject` is an HttpOnly, SameSite=Lax cookie with a one-year lifetime. It is Secure in
  production and is never exposed to client JavaScript.

## Vote behavior

- Guest preparation and Issue loading run together on entry.
- One `crypto.randomUUID()` idempotency key is created per choice action. Retrying a failed request
  reuses the same key.
- The UI locks submission immediately to prevent rapid double clicks.
- A stale or missing upstream Guest Subject is reissued by the BFF, then the same Vote command is
  retried once with the original idempotency key.
- A duplicate response shows the originally accepted choice and explains that the first choice is
  preserved.

## Result and accessibility

- Counts and percentages are absent before the user votes.
- After acceptance or a duplicate response, the server-provided tally is rendered with the user's
  accepted choice marked.
- Loading, unavailable, transport failure, submitting, retry, and result states use live regions and
  keyboard-accessible buttons.

## Verification

- Web component tests cover result gating, rapid double-click protection, duplicate explanation, and
  recoverable load errors.
- `pnpm check` verifies formatting, lint, types, API/Web tests, and production builds.
- Mobile browser verification at 390×844 covers initial choice, accepted result, reload, opposite
  choice attempt, and first-choice preservation without reading browser storage directly.

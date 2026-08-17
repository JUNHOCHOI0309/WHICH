# Member Identity & Guest Vote Linking v1

## Identity boundary

- Google OIDC is verified only in the Web BFF with `openid-client`.
- The API accepts a provider assertion only through `POST /v1/internal/member-sessions`, protected by `INTERNAL_AUTH_SECRET`.
- `member_identity_links` uses `(provider, provider_subject)` as the canonical identity key. Email is intentionally not stored or used for automatic merging.
- The `DEVELOPMENT` provider exists only for local and integration tests and is rejected in production.

## Session boundary

- Every successful provider assertion issues a new 32-byte random Member session token.
- Only the SHA-256 token hash is stored in `member_sessions`.
- The Web BFF stores the raw token in the `which_member_session` HttpOnly, SameSite=Lax cookie; Secure is enabled in production.
- `GET /v1/member-session` reads the session and `DELETE /v1/member-session` revokes it.
- The Web BFF logout route rejects cross-origin DELETE requests.

## Guest linking and vote integrity

- `guest_member_links` preserves the original Guest and Member voter subjects instead of rewriting vote ownership.
- A Guest subject can link to only one Member. A Member can link multiple Guest subjects.
- Guest-only accepted votes remain accepted and require no aggregate change.
- If Guest and Member both have an accepted vote for the same Issue, the Member vote is canonical.
- The Guest duplicate is moved to `INVALIDATED` with reason `GUEST_MEMBER_LINK_DUPLICATE`; aggregate, result snapshot, integrity decision, and `VOTE_INVALIDATED` outbox event are updated in one transaction.
- Linking is idempotent, so retrying cannot decrement the aggregate twice.

## Web return-state contract

- OIDC state, nonce, PKCE verifier, return path, and timestamp live in a signed 10-minute HttpOnly flow cookie.
- Return paths are restricted to same-origin application paths and cannot point back into `/api/auth/*`.
- Success, cancellation, provider failure, and missing configuration return to the original Issue with an `auth` outcome query.
- The latest vote result is stored in `sessionStorage` per Issue so the result view survives the OAuth round trip.

## Required production configuration

- `INTERNAL_AUTH_SECRET`
- `AUTH_INTERNAL_SECRET` with the same value
- `AUTH_FLOW_SECRET` as a separate random value
- `AUTH_BASE_URL`
- `GOOGLE_OIDC_CLIENT_ID`
- `GOOGLE_OIDC_CLIENT_SECRET`

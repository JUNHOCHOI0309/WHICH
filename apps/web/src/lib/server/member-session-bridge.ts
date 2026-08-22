import { fetchWhichApi } from "./which-api";
import { internalAuthSecret } from "./member-auth";
import type { AuthFlow, AuthOutcome } from "./member-auth";

type Provider = "GOOGLE" | "X" | "NAVER" | "KAKAO";

type SessionResponse = {
  token: string;
  expiresAt: string;
};

type SessionApiResponse = Partial<SessionResponse> & {
  code?: string;
};

type SessionInput = {
  provider: Provider;
  providerSubject: string;
  displayName: string;
  anonymousSubjectId?: string | null;
};

export class MemberIdentityLinkError extends Error {
  constructor(public readonly code: string) {
    super("WHICH Member identity linking failed.");
    this.name = "MemberIdentityLinkError";
  }
}

export function oauthFailureOutcome(error: unknown): AuthOutcome {
  return error instanceof MemberIdentityLinkError && error.code === "MEMBER_MERGE_REQUIRES_REVIEW"
    ? "merge-review"
    : "error";
}

async function requestMemberSession(input: SessionInput, includeGuestSubject: boolean) {
  const upstream = await fetchWhichApi("/v1/internal/member-sessions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify({
      provider: input.provider,
      providerSubject: input.providerSubject,
      displayName: input.displayName,
      ...(includeGuestSubject && input.anonymousSubjectId
        ? { anonymousSubjectId: input.anonymousSubjectId }
        : {}),
    }),
  });
  const body = (await upstream.json()) as SessionApiResponse;
  return { upstream, body };
}

export async function createProviderMemberSession(input: SessionInput) {
  let result = await requestMemberSession(input, true);

  if (
    input.anonymousSubjectId &&
    result.upstream.status === 409 &&
    result.body.code === "GUEST_ALREADY_LINKED"
  ) {
    result = await requestMemberSession(input, false);
  }

  if (!result.upstream.ok || !result.body.token || !result.body.expiresAt) {
    throw new Error("WHICH Member session creation failed.");
  }
  return { token: result.body.token, expiresAt: result.body.expiresAt };
}

export async function memberIdForLinkIntent(requestUrl: URL, memberSessionToken?: string) {
  if (requestUrl.searchParams.get("intent") !== "link") return undefined;
  if (!memberSessionToken) throw new Error("A Member session is required to link an identity.");

  const upstream = await fetchWhichApi("/v1/member-session", {
    headers: { accept: "application/json", authorization: `Bearer ${memberSessionToken}` },
  });
  const body = (await upstream.json()) as { member?: { id?: string } };
  if (!upstream.ok || !body.member?.id) {
    throw new Error("The Member session for identity linking is invalid.");
  }
  return body.member.id;
}

export async function createOAuthMemberSession(flow: AuthFlow, input: SessionInput) {
  if (flow.intent !== "LINK" || !flow.linkMemberId) {
    return createProviderMemberSession(input);
  }

  const upstream = await fetchWhichApi("/v1/internal/member-identity-links", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify({
      memberId: flow.linkMemberId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      displayName: input.displayName,
    }),
  });
  const body = (await upstream.json()) as SessionApiResponse;
  if (!upstream.ok || !body.token || !body.expiresAt) {
    throw new MemberIdentityLinkError(body.code ?? "IDENTITY_LINK_FAILED");
  }
  return { token: body.token, expiresAt: body.expiresAt };
}

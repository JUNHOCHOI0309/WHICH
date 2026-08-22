import { fetchWhichApi } from "./which-api";
import { internalAuthSecret } from "./member-auth";
import type { AuthFlow, AuthOutcome } from "./member-auth";

type SocialProvider = "GOOGLE" | "X" | "NAVER" | "KAKAO";
type Provider = "EMAIL" | SocialProvider;

type SessionResponse = {
  token: string;
  expiresAt: string;
  member?: { id: string };
};

type SessionApiResponse = Partial<SessionResponse> & {
  code?: string;
};

type SessionInput = {
  provider: Provider;
  providerSubject: string;
  displayName: string;
  anonymousSubjectId?: string | null;
  suggestedEmail?: string;
};
type SocialSessionInput = Omit<SessionInput, "provider"> & { provider: SocialProvider };

export type OAuthMemberSessionResult =
  | { kind: "session"; token: string; expiresAt: string }
  | { kind: "signup"; input: SocialSessionInput };

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

async function requestMemberSession(
  input: SessionInput,
  includeGuestSubject: boolean,
  createIfMissing = true,
  credential?: { email: string; password: string },
) {
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
      ...(createIfMissing ? {} : { createIfMissing: false }),
      ...(credential ? { credential } : {}),
      ...(includeGuestSubject && input.anonymousSubjectId
        ? { anonymousSubjectId: input.anonymousSubjectId }
        : {}),
    }),
  });
  const body = (await upstream.json()) as SessionApiResponse;
  return { upstream, body };
}

async function requestCredentialSession(input: {
  email: string;
  password: string;
  anonymousSubjectId?: string | null;
}) {
  const upstream = await fetchWhichApi("/v1/internal/member-credential-sessions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      ...(input.anonymousSubjectId ? { anonymousSubjectId: input.anonymousSubjectId } : {}),
    }),
  });
  const body = (await upstream.json()) as SessionApiResponse;
  return { upstream, body };
}

function requireSessionResponse(result: { upstream: Response; body: SessionApiResponse }) {
  if (!result.upstream.ok || !result.body.token || !result.body.expiresAt) {
    throw new MemberIdentityLinkError(result.body.code ?? "CREDENTIAL_AUTH_FAILED");
  }
  return {
    token: result.body.token,
    expiresAt: result.body.expiresAt,
    memberId: result.body.member?.id,
  };
}

export async function createCredentialMemberSession(input: {
  mode: "login" | "signup";
  email: string;
  password: string;
  anonymousSubjectId?: string | null;
}) {
  if (input.mode === "login") {
    return requireSessionResponse(await requestCredentialSession(input));
  }
  const displayName = input.email.split("@", 1)[0] || "WHICH 회원";
  return requireSessionResponse(
    await requestMemberSession(
      {
        provider: "EMAIL",
        providerSubject: input.email,
        displayName,
        anonymousSubjectId: input.anonymousSubjectId,
      },
      true,
      true,
      { email: input.email, password: input.password },
    ),
  );
}

export async function completeSocialSignup(input: {
  mode: "new" | "existing";
  social: SocialSessionInput;
  email: string;
  password: string;
}) {
  if (input.mode === "new") {
    return requireSessionResponse(
      await requestMemberSession(input.social, true, true, {
        email: input.email,
        password: input.password,
      }),
    );
  }

  const credentialSession = requireSessionResponse(
    await requestCredentialSession({
      email: input.email,
      password: input.password,
      anonymousSubjectId: input.social.anonymousSubjectId,
    }),
  );
  if (!credentialSession.memberId) {
    throw new MemberIdentityLinkError("CREDENTIAL_AUTH_FAILED");
  }
  const upstream = await fetchWhichApi("/v1/internal/member-identity-links", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify({
      memberId: credentialSession.memberId,
      provider: input.social.provider,
      providerSubject: input.social.providerSubject,
      displayName: input.social.displayName,
    }),
  });
  const body = (await upstream.json()) as SessionApiResponse;
  if (!upstream.ok || !body.token || !body.expiresAt) {
    await fetchWhichApi("/v1/member-session", {
      method: "DELETE",
      headers: { authorization: `Bearer ${credentialSession.token}` },
    }).catch(() => undefined);
    throw new MemberIdentityLinkError(body.code ?? "IDENTITY_LINK_FAILED");
  }
  return { token: body.token, expiresAt: body.expiresAt, memberId: credentialSession.memberId };
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

export async function createOAuthMemberSession(flow: AuthFlow, input: SocialSessionInput) {
  if (flow.intent !== "LINK" || !flow.linkMemberId) {
    let result = await requestMemberSession(input, true, false);
    if (result.upstream.status === 409 && result.body.code === "IDENTITY_SIGNUP_REQUIRED") {
      return { kind: "signup", input } satisfies OAuthMemberSessionResult;
    }
    if (
      input.anonymousSubjectId &&
      result.upstream.status === 409 &&
      result.body.code === "GUEST_ALREADY_LINKED"
    ) {
      result = await requestMemberSession(input, false, false);
    }
    if (!result.upstream.ok || !result.body.token || !result.body.expiresAt) {
      throw new Error("WHICH Member session creation failed.");
    }
    return {
      kind: "session",
      token: result.body.token,
      expiresAt: result.body.expiresAt,
    } satisfies OAuthMemberSessionResult;
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
  return {
    kind: "session",
    token: body.token,
    expiresAt: body.expiresAt,
  } satisfies OAuthMemberSessionResult;
}

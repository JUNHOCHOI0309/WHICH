import { fetchWhichApi } from "./which-api";
import { internalAuthSecret } from "./member-auth";

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

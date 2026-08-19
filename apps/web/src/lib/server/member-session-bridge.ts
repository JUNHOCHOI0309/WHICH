import { fetchWhichApi } from "./which-api";
import { internalAuthSecret } from "./member-auth";

type Provider = "GOOGLE" | "X";

type SessionResponse = {
  token: string;
  expiresAt: string;
};

export async function createProviderMemberSession(input: {
  provider: Provider;
  providerSubject: string;
  displayName: string;
  anonymousSubjectId?: string | null;
}) {
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
      ...(input.anonymousSubjectId ? { anonymousSubjectId: input.anonymousSubjectId } : {}),
    }),
  });
  const session = (await upstream.json()) as Partial<SessionResponse>;
  if (!upstream.ok || !session.token || !session.expiresAt) {
    throw new Error("WHICH Member session creation failed.");
  }
  return { token: session.token, expiresAt: session.expiresAt };
}

import { describe, expect, it, vi } from "vitest";

import {
  buildXAuthorizationUrl,
  exchangeXAuthorizationCode,
  fetchXProfile,
  xDisplayName,
} from "@/lib/server/x-oauth";

describe("X OAuth client", () => {
  it("builds a minimal Authorization Code + PKCE request", () => {
    const url = buildXAuthorizationUrl({
      clientId: "x-client",
      redirectUri: "https://whichone.site/api/auth/x/callback",
      state: "state",
      codeChallenge: "challenge",
    });

    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "x-client",
      redirect_uri: "https://whichone.site/api/auth/x/callback",
      scope: "users.read tweet.read",
      state: "state",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.has("offline.access")).toBe(false);
  });

  it("exchanges the code as a confidential client and reads the authenticated user", async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/2/oauth2/token")) {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
        expect(String(init?.body)).toContain("code_verifier=verifier");
        return Response.json({ access_token: "ephemeral-access-token" });
      }
      expect(url).toBe("https://api.x.com/2/users/me");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ephemeral-access-token");
      return Response.json({ data: { id: "x-user-1", name: "X 사용자", username: "which_x" } });
    });

    const accessToken = await exchangeXAuthorizationCode(
      {
        credentials: { clientId: "x-client", clientSecret: "x-secret" },
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "https://whichone.site/api/auth/x/callback",
      },
      request,
    );
    const profile = await fetchXProfile(accessToken, request);

    expect(profile).toEqual({ id: "x-user-1", name: "X 사용자", username: "which_x" });
    expect(xDisplayName(profile)).toBe("X 사용자");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

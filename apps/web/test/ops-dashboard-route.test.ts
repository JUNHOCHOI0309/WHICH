import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "remote-jwks"),
  jwtVerify: vi.fn(async () => ({ payload: { email: "operator@example.com" } })),
}));

import { GET } from "@/app/api/ops/dashboard/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("operator dashboard BFF", () => {
  it("requires a WHICH Member session before calling the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await GET(new NextRequest("https://whichone.site/api/ops/dashboard?days=7"));
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards only the Member token and internal secret in role-only local mode", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/internal/ops/dashboard?days=30");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      expect(new Headers(init?.headers).get("x-internal-auth-secret")).toBe(
        "which-local-internal-auth-secret",
      );
      return new Response(JSON.stringify({ schemaVersion: 1, role: "OPERATOR" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await GET(
      new NextRequest("https://whichone.site/api/ops/dashboard?days=30", {
        headers: { cookie: "which_member_session=member-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed when Cloudflare Access is only partially configured", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "https://which.cloudflareaccess.com");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await GET(
      new NextRequest("https://whichone.site/api/ops/dashboard?days=7", {
        headers: { cookie: "which_member_session=member-token" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CF_ACCESS_MISCONFIGURED" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("verifies the Access assertion before forwarding a production read", async () => {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "https://which.cloudflareaccess.com");
    vi.stubEnv("CF_ACCESS_AUD", "which-ops-audience");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ schemaVersion: 1, role: "OPERATOR" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const response = await GET(
      new NextRequest("https://whichone.site/api/ops/dashboard?days=1", {
        headers: {
          cookie: "which_member_session=member-token",
          "cf-access-jwt-assertion": "signed-access-jwt",
        },
      }),
    );
    expect(response.status).toBe(200);
  });
});

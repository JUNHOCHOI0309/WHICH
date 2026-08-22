import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE as logout } from "@/app/api/member-session/route";

function logoutRequest(options?: {
  origin?: string;
  csrf?: boolean;
  cookie?: boolean;
  url?: string;
}) {
  const headers = new Headers();
  if (options?.origin !== undefined) headers.set("origin", options.origin);
  if (options?.csrf !== false) headers.set("x-which-csrf", "member-session-logout");
  if (options?.cookie !== false) headers.set("cookie", "which_member_session=member-token");
  return new NextRequest(options?.url ?? "https://whichone.site/api/member-session", {
    method: "DELETE",
    headers,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Member session logout BFF", () => {
  it("revokes the API session and clears the Cookie after a 204", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/member-session");
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await logout(logoutRequest({ origin: "https://whichone.site" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("which_member_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("treats an already invalid API session as an idempotent logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    const response = await logout(logoutRequest({ origin: "https://whichone.site" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([500, 503])("keeps the Cookie when the API returns %i", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );

    const response = await logout(logoutRequest({ origin: "https://whichone.site" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "SESSION_REVOKE_FAILED" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the Cookie when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );

    const response = await logout(logoutRequest({ origin: "https://whichone.site" }));

    expect(response.status).toBe(502);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts an Origin-less WebView request with the protected CSRF Header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const response = await logout(logoutRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("accepts the configured public Origin behind an internal reverse proxy URL", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const response = await logout(
      logoutRequest({
        origin: "https://whichone.site",
        url: "https://which-web.onrender.com/api/member-session",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    { name: "cross-origin", request: { origin: "https://attacker.example" } },
    { name: "missing CSRF Header", request: { origin: "https://whichone.site", csrf: false } },
  ])("rejects a $name request without clearing the Cookie", async ({ request }) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await logout(logoutRequest(request));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("clears a stale local Cookie without calling the API when no token exists", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await logout(
      logoutRequest({ origin: "https://whichone.site", cookie: false }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(upstream).not.toHaveBeenCalled();
  });
});

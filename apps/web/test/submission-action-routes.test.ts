import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/issue-submissions/[submissionId]/actions/route";
import { POST as mobilePost } from "@/app/api/mobile/v1/member/issue-submissions/[submissionId]/actions/route";
import { GET } from "@/app/api/issue-submissions/route";
const upstream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/which-api", () => ({
  MEMBER_SESSION_COOKIE: "member",
  fetchWhichApi: upstream,
}));
const context = { params: Promise.resolve({ submissionId: "example" }) };
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("submission action forwarding", () => {
  it("forwards a specific status read without mutation or caching", async () => {
    upstream.mockResolvedValue(Response.json({ items: [] }));
    const response = await GET(
      new NextRequest("https://whichone.site/api/issue-submissions?limit=1&submissionId=example", {
        headers: { cookie: "member=test" },
      }),
    );
    expect(upstream).toHaveBeenCalledWith(
      "/v1/member/issue-submissions?limit=1&submissionId=example",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test" }),
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    upstream.mockClear();
    expect((await GET(new NextRequest("https://whichone.site/api/issue-submissions"))).status).toBe(
      401,
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects missing sessions and foreign origins without calling the API", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    expect(
      (await POST(new NextRequest("https://whichone.site/api/test", { method: "POST" }), context))
        .status,
    ).toBe(401);
    expect(
      (
        await POST(
          new NextRequest("https://whichone.site/api/test", {
            method: "POST",
            headers: { cookie: "member=test", origin: "https://attacker.example" },
          }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("forwards the exact revision with server-held authentication", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    upstream.mockResolvedValue(new Response('{"created":true}', { status: 200 }));
    const body = JSON.stringify({ action: "CANCEL", expectedRevision: 3 });
    expect(
      (
        await POST(
          new NextRequest("https://whichone.site/api/test", {
            method: "POST",
            headers: { cookie: "member=test", origin: "https://whichone.site" },
            body,
          }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      "/v1/member/issue-submissions/example/actions",
      expect.objectContaining({
        body,
        headers: expect.objectContaining({ authorization: "Bearer test" }),
      }),
    );
  });
  it("requires Bearer for mobile instead of accepting browser cookies", async () => {
    expect(
      (
        await mobilePost(
          new NextRequest("https://whichone.site/api/test", {
            method: "POST",
            headers: { cookie: "member=test" },
          }),
          context,
        )
      ).status,
    ).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});

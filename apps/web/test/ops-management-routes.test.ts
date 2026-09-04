import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "remote-jwks"),
  jwtVerify: vi.fn(async () => ({ payload: { email: "operator@example.com" } })),
}));

import { GET as getEditorial } from "@/app/api/ops/editorial/route";
import { PUT as putDecision } from "@/app/api/ops/editorial/[candidateId]/decision/route";
import { POST as postEditorialPublish } from "@/app/api/ops/editorial/[candidateId]/publish/route";
import {
  DELETE as deleteEditorialMedia,
  PUT as putEditorialMedia,
} from "@/app/api/ops/editorial/[candidateId]/choices/[choiceCode]/media/route";
import { GET as getMembers } from "@/app/api/ops/members/route";
import { GET as getPointShop } from "@/app/api/ops/point-shop/route";
import { PATCH as patchPointShopItem } from "@/app/api/ops/point-shop/[itemId]/route";
import { GET as getPublishedIssues } from "@/app/api/ops/published-issues/route";
import {
  PATCH as patchPublishedIssue,
  POST as postPublishedIssueMedia,
} from "@/app/api/ops/published-issues/[issueId]/route";
import { GET as getReportedMembers } from "@/app/api/ops/reported-members/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("operator management BFF", () => {
  it("forwards only bounded Member directory filters", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://localhost:4000/v1/internal/ops/members?status=ACTIVE&q=maker&limit=25",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      return new Response(JSON.stringify({ schemaVersion: 1, items: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getMembers(
      new NextRequest(
        "https://whichone.site/api/ops/members?status=ACTIVE&q=maker&ignored=secret",
        { headers: { cookie: "which_member_session=member-token" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects invalid Editorial filters before an upstream request", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await getEditorial(
      new NextRequest("https://whichone.site/api/ops/editorial?scope=SECRET", {
        headers: { cookie: "which_member_session=member-token" },
      }),
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires a same-origin request for Editorial decisions", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await putDecision(
      new NextRequest("https://whichone.site/api/ops/editorial/candidate-1/decision", {
        method: "PUT",
        headers: {
          cookie: "which_member_session=member-token",
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ candidateId: "candidate-1" }) },
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a same-origin decision and preserves a revision conflict", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://localhost:4000/v1/internal/ops/editorial/candidate-1/decision",
      );
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        expectedRevision: 1,
        status: "REJECTED",
      });
      return new Response(
        JSON.stringify({ code: "REVISION_CONFLICT", message: "changed", current: null }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", upstream);
    const response = await putDecision(
      new NextRequest("https://whichone.site/api/ops/editorial/candidate-1/decision", {
        method: "PUT",
        headers: {
          cookie: "which_member_session=member-token",
          origin: "https://whichone.site",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedRevision: 1,
          status: "REJECTED",
          note: "duplicate",
          checks: {
            binaryFit: true,
            choiceParity: true,
            duplicateReview: false,
            sourceReview: true,
          },
        }),
      }),
      { params: Promise.resolve({ candidateId: "candidate-1" }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("forwards an approved candidate publication with its current revision", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://localhost:4000/v1/internal/ops/editorial/WEXP-0001/publish",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 2 });
      return new Response(JSON.stringify({ issue: { issueId: crypto.randomUUID(), version: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await postEditorialPublish(
      new NextRequest("https://whichone.site/api/ops/editorial/WEXP-0001/publish", {
        method: "POST",
        headers: {
          cookie: "which_member_session=member-token",
          origin: "https://whichone.site",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: 2 }),
      }),
      { params: Promise.resolve({ candidateId: "WEXP-0001" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("forwards candidate media linking and unlinking through the Ops boundary", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://localhost:4000/v1/internal/ops/editorial/WEXP-0001/choices/A/media",
      );
      return new Response(JSON.stringify({ ok: true, method: init?.method }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const context = { params: Promise.resolve({ candidateId: "WEXP-0001", choiceCode: "A" }) };
    const attach = await putEditorialMedia(
      new NextRequest("https://whichone.site/api/ops/editorial/WEXP-0001/choices/A/media", {
        method: "PUT",
        headers: {
          cookie: "which_member_session=member-token",
          origin: "https://whichone.site",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assetId: crypto.randomUUID(),
          altText: "선택지 이미지",
          cropMode: "COVER",
        }),
      }),
      context,
    );
    const detach = await deleteEditorialMedia(
      new NextRequest("https://whichone.site/api/ops/editorial/WEXP-0001/choices/A/media", {
        method: "DELETE",
        headers: { cookie: "which_member_session=member-token", origin: "https://whichone.site" },
      }),
      context,
    );
    expect(attach.status).toBe(200);
    expect(detach.status).toBe(200);
    expect(upstream.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "DELETE"]);
  });

  it("forwards Point Shop reads through the protected Ops boundary", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/internal/ops/point-shop");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      return new Response(JSON.stringify({ schemaVersion: 1, items: [], audit: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getPointShop(
      new NextRequest("https://whichone.site/api/ops/point-shop", {
        headers: { cookie: "which_member_session=member-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires same-origin mutations for Point Shop updates", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const updateResponse = await patchPointShopItem(
      new NextRequest(
        "https://whichone.site/api/ops/point-shop/10503719-4d3b-4abf-a1ee-ec0920d72e9a",
        {
          method: "PATCH",
          headers: {
            cookie: "which_member_session=member-token",
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      { params: Promise.resolve({ itemId: "10503719-4d3b-4abf-a1ee-ec0920d72e9a" }) },
    );
    expect(updateResponse.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards bounded report-account and published-Issue filters", async () => {
    const upstream = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect([
        "/v1/internal/ops/reported-members?limit=50&state=BLOCKED&q=maker",
        "/v1/internal/ops/published-issues?limit=50&state=ACTIVE&reported=true&q=lunch",
      ]).toContain(new URL(url).pathname + new URL(url).search);
      return new Response(JSON.stringify({ schemaVersion: 1, items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const [reported, published] = await Promise.all([
      getReportedMembers(
        new NextRequest("https://whichone.site/api/ops/reported-members?state=BLOCKED&q=maker", {
          headers: { cookie: "which_member_session=member-token" },
        }),
      ),
      getPublishedIssues(
        new NextRequest(
          "https://whichone.site/api/ops/published-issues?state=ACTIVE&reported=true&q=lunch",
          { headers: { cookie: "which_member_session=member-token" } },
        ),
      ),
    ]);
    expect(reported.status).toBe(200);
    expect(published.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("requires same-origin requests for published-Issue actions", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await patchPublishedIssue(
      new NextRequest(
        "https://whichone.site/api/ops/published-issues/10503719-4d3b-4abf-a1ee-ec0920d72e9a",
        {
          method: "PATCH",
          headers: {
            cookie: "which_member_session=member-token",
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      { params: Promise.resolve({ issueId: "10503719-4d3b-4abf-a1ee-ec0920d72e9a" }) },
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards same-origin published-Issue media revisions", async () => {
    const issueId = "10503719-4d3b-4abf-a1ee-ec0920d72e9a";
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        `http://localhost:4000/v1/internal/ops/published-issues/${issueId}/media-revision`,
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ expectedVersion: 1 });
      return new Response(JSON.stringify({ issueId, version: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await postPublishedIssueMedia(
      new NextRequest(`https://whichone.site/api/ops/published-issues/${issueId}`, {
        method: "POST",
        headers: {
          cookie: "which_member_session=member-token",
          origin: "https://whichone.site",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedVersion: 1, choices: [] }),
      }),
      { params: Promise.resolve({ issueId }) },
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("forwards same-origin Point Shop status updates", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://localhost:4000/v1/internal/ops/point-shop/items/10503719-4d3b-4abf-a1ee-ec0920d72e9a",
      );
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        status: "PAUSED",
        reason: "판매 상태 변경: 판매 중 → 판매 중지",
      });
      return new Response(JSON.stringify({ id: "10503719-4d3b-4abf-a1ee-ec0920d72e9a" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await patchPointShopItem(
      new NextRequest(
        "https://whichone.site/api/ops/point-shop/10503719-4d3b-4abf-a1ee-ec0920d72e9a",
        {
          method: "PATCH",
          headers: {
            cookie: "which_member_session=member-token",
            origin: "https://whichone.site",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision: 1,
            price: 500,
            status: "PAUSED",
            reason: "판매 상태 변경: 판매 중 → 판매 중지",
          }),
        },
      ),
      { params: Promise.resolve({ itemId: "10503719-4d3b-4abf-a1ee-ec0920d72e9a" }) },
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
});

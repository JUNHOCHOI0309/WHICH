import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as reportComment } from "@/app/api/comments/[commentId]/reports/route";
import { POST as reportIssue } from "@/app/api/reports/route";
import { POST as reactToComment } from "@/app/api/comments/[commentId]/reactions/helpful/route";
import {
  DELETE as deleteComment,
  PATCH as updateComment,
} from "@/app/api/comments/[commentId]/route";
import { POST as publishComment } from "@/app/api/issues/[issueId]/comments/route";
import { PUT as recommendIssue } from "@/app/api/issues/[issueId]/recommendation/route";
import { POST as submitVote } from "@/app/api/issues/[issueId]/votes/route";

const issueId = "591f2e90-996a-50c5-af46-967dd0793000";
const commentId = "8c092a45-c446-50f3-b1ac-ac9a018b9105";
const guestSubjectId = "4f748dd9-f960-5a70-8d9a-8ce9b072e830";
const idempotencyKey = "ad457734-dadb-59e6-ad7c-1ad7f6a99d76";
const choiceId = "24d3656a-a62e-5ca4-9363-3dc269281ed2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mutationRequest(
  path: string,
  body?: unknown,
  origin = "https://whichone.site",
  method = "POST",
) {
  return new NextRequest(`https://which-web.onrender.com${path}`, {
    method,
    headers: {
      origin,
      cookie: `which_member_session=member-token; which_guest_subject=${guestSubjectId}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Comment mutation BFF Origin handling", () => {
  it("accepts the configured public Origin and forwards Member plus Guest identity", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      jsonResponse(
        {
          comment: {
            id: commentId,
            choice: "A",
            author: { displayName: "작성자" },
            body: "선택 이유",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await publishComment(
      mutationRequest(`/api/issues/${issueId}/comments`, { body: "선택 이유" }),
      { params: Promise.resolve({ issueId }) },
    );

    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledWith(
      new URL(`http://localhost:4000/v1/issues/${issueId}/comments`),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer member-token",
          "x-anonymous-subject-id": guestSubjectId,
        }),
      }),
    );
  });

  it("rejects a different Origin before calling the API", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await publishComment(
      mutationRequest(
        `/api/issues/${issueId}/comments`,
        { body: "선택 이유" },
        "https://attacker.example",
      ),
      { params: Promise.resolve({ issueId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CSRF_REJECTED" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("uses the same public Origin rule for helpful reactions", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn(async () =>
      jsonResponse({
        reaction: { code: "HELPFUL", active: true, helpfulCount: 1, dislikeCount: 0 },
      }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await reactToComment(
      mutationRequest(`/api/comments/${commentId}/reactions/helpful`),
      { params: Promise.resolve({ commentId }) },
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("protects and forwards an authenticated Issue recommendation", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn(async () =>
      jsonResponse({ recommendation: { active: true, count: 4 } }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await recommendIssue(
      mutationRequest(`/api/issues/${issueId}/recommendation`, { active: true }, undefined, "PUT"),
      { params: Promise.resolve({ issueId }) },
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      new URL(`http://localhost:4000/v1/issues/${issueId}/recommendation`),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ authorization: "Bearer member-token" }),
        body: JSON.stringify({ active: true }),
      }),
    );
  });

  it("uses the same public Origin rule for reports", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn(async () =>
      jsonResponse(
        {
          report: { accepted: true, viewerReported: true },
          comment: { visibility: "VISIBLE" },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await reportComment(
      mutationRequest(`/api/comments/${commentId}/reports`, { reason: "SPAM" }),
      { params: Promise.resolve({ commentId }) },
    );

    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("protects and forwards a public Issue report with both available identities", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi.fn(async () =>
      jsonResponse(
        {
          report: { id: "report-1", accepted: true, counted: true },
          case: {
            id: "case-1",
            status: "OPEN",
            priority: "NORMAL",
            automationRecommendation: "NONE",
          },
          signals: {
            reporterCount: 1,
            weightedScore: 2,
            reports15m: 1,
            reports24h: 1,
            clusterClassification: "BASELINE",
            shadowOnly: true,
          },
          target: { hidden: false },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", upstream);

    const request = mutationRequest("/api/reports", {
      targetType: "ISSUE",
      targetId: issueId,
      reasonCode: "SPAM",
    });
    const response = await reportIssue(request);

    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/reports"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer member-token",
          "x-anonymous-subject-id": guestSubjectId,
          "idempotency-key": idempotencyKey,
        }),
      }),
    );
  });

  it("protects and forwards author edit and delete requests", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    const upstream = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          comment: {
            id: commentId,
            body: "수정한 댓글",
            editedAt: "2026-08-24T08:30:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ comment: { id: commentId, deleted: true } }));
    vi.stubGlobal("fetch", upstream);

    const updated = await updateComment(
      mutationRequest(
        `/api/comments/${commentId}`,
        { body: "수정한 댓글" },
        "https://whichone.site",
        "PATCH",
      ),
      { params: Promise.resolve({ commentId }) },
    );
    const deleted = await deleteComment(
      mutationRequest(`/api/comments/${commentId}`, undefined, "https://whichone.site", "DELETE"),
      { params: Promise.resolve({ commentId }) },
    );

    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(upstream).toHaveBeenNthCalledWith(
      1,
      new URL(`http://localhost:4000/v1/comments/${commentId}`),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ authorization: "Bearer member-token" }),
      }),
    );
    expect(upstream).toHaveBeenNthCalledWith(
      2,
      new URL(`http://localhost:4000/v1/comments/${commentId}`),
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ authorization: "Bearer member-token" }),
      }),
    );

    const rejected = await deleteComment(
      mutationRequest(
        `/api/comments/${commentId}`,
        undefined,
        "https://attacker.example",
        "DELETE",
      ),
      { params: Promise.resolve({ commentId }) },
    );
    expect(rejected.status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe("Member Vote BFF", () => {
  it("forwards an active Member session without creating a new Guest subject", async () => {
    const upstream = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      jsonResponse(
        {
          outcome: "ACCEPTED",
          voteAttemptId: idempotencyKey,
          voteId: "1a682aaa-408e-5c62-8b5d-7ee5ffbf95a6",
          issueId,
          issueVersion: 1,
          choice: "A",
          result: {
            resultVersion: 1,
            acceptedA: 1,
            acceptedB: 0,
            displayedTotal: 1,
            integrityState: "NORMAL",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await submitVote(
      new NextRequest(`https://whichone.site/api/issues/${issueId}/votes`, {
        method: "POST",
        headers: {
          cookie: "which_member_session=member-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ issueVersion: 1, choiceId, idempotencyKey }),
      }),
      { params: Promise.resolve({ issueId }) },
    );

    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer member-token");
    expect(headers.get("x-anonymous-subject-id")).toBeNull();
    expect(response.headers.get("set-cookie")).not.toContain("which_guest_subject=");
  });
});

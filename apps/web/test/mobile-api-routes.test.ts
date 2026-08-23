import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as createSubject } from "@/app/api/mobile/v1/guest-subjects/route";
import { POST as recordAnalyticsEvent } from "@/app/api/mobile/v1/analytics/events/route";
import {
  GET as loadInterestProfile,
  PUT as saveInterestProfile,
} from "@/app/api/mobile/v1/interest-profile/route";
import { GET as loadFeed } from "@/app/api/mobile/v1/issues/feed/route";
import { GET as loadCommentHighlights } from "@/app/api/mobile/v1/issues/[issueId]/comment-highlights/route";
import { POST as submitVote } from "@/app/api/mobile/v1/issues/[issueId]/votes/route";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mobile BFF routes", () => {
  it("returns a Guest Subject to the native client without exposing an internal secret", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ anonymousSubjectId: "591f2e90-996a-50c5-af46-967dd0793000" }, 201),
    );
    vi.stubGlobal("fetch", request);

    const response = await createSubject();

    await expect(response.json()).resolves.toEqual({
      anonymousSubjectId: "591f2e90-996a-50c5-af46-967dd0793000",
    });
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/guest-subjects"),
      expect.not.objectContaining({
        headers: expect.objectContaining({ "x-internal-auth-secret": expect.anything() }),
      }),
    );
  });

  it("forwards a valid native Guest Subject to feed selection", async () => {
    const request = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", request);

    const response = await loadFeed(
      new NextRequest("https://whichone.site/api/mobile/v1/issues/feed?limit=12", {
        headers: { "x-anonymous-subject-id": "591f2e90-996a-50c5-af46-967dd0793000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/issues/feed?limit=12"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-anonymous-subject-id": "591f2e90-996a-50c5-af46-967dd0793000",
        }),
      }),
    );
  });

  it("rejects a native Vote without a valid Guest Subject", async () => {
    const response = await submitVote(
      new NextRequest(
        "https://whichone.site/api/mobile/v1/issues/591f2e90-996a-50c5-af46-967dd0793000/votes",
        { method: "POST", body: JSON.stringify({}) },
      ),
      { params: Promise.resolve({ issueId: "591f2e90-996a-50c5-af46-967dd0793000" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_GUEST_SUBJECT" });
  });

  it("forwards one native highlight request after Vote completion", async () => {
    const request = vi.fn(async () => jsonResponse({ A: [], B: [] }));
    vi.stubGlobal("fetch", request);
    const subjectId = "8c092a45-c446-50f3-b1ac-ac9a018b9105";
    const issueId = "591f2e90-996a-50c5-af46-967dd0793000";

    const response = await loadCommentHighlights(
      new NextRequest(`https://whichone.site/api/mobile/v1/issues/${issueId}/comment-highlights`, {
        headers: { "x-anonymous-subject-id": subjectId },
      }),
      { params: Promise.resolve({ issueId }) },
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL(`http://localhost:4000/v1/issues/${issueId}/comment-highlights?limitPerSide=5`),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-anonymous-subject-id": subjectId }),
      }),
    );
  });

  it("preserves native Vote idempotency at the server boundary", async () => {
    const request = vi.fn(async () =>
      jsonResponse(
        {
          outcome: "ACCEPTED",
          voteAttemptId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          voteId: "d52dace5-486c-5e34-bb73-5a0b5a779c98",
          issueId: "591f2e90-996a-50c5-af46-967dd0793000",
          issueVersion: 1,
          choice: "A",
          result: {
            resultVersion: 2,
            acceptedA: 1,
            acceptedB: 0,
            displayedTotal: 1,
            integrityState: "NORMAL",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", request);

    const response = await submitVote(
      new NextRequest(
        "https://whichone.site/api/mobile/v1/issues/591f2e90-996a-50c5-af46-967dd0793000/votes",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-anonymous-subject-id": "8c092a45-c446-50f3-b1ac-ac9a018b9105",
          },
          body: JSON.stringify({
            issueVersion: 1,
            choiceId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
            idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
          }),
        },
      ),
      { params: Promise.resolve({ issueId: "591f2e90-996a-50c5-af46-967dd0793000" }) },
    );

    expect(response.status).toBe(201);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/issues/591f2e90-996a-50c5-af46-967dd0793000/votes"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "idempotency-key": "ce976502-9409-56a2-b975-94c913a20fcf",
          "x-anonymous-subject-id": "8c092a45-c446-50f3-b1ac-ac9a018b9105",
        }),
      }),
    );
  });

  it("forwards the native Guest Subject to the shared Interest Profile API", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        taxonomyVersion: "interest_cards_v1",
        onboardingState: "NOT_STARTED",
        selectedCardCodes: [],
        canSkip: true,
        profileVersion: 1,
        mergeCandidate: null,
      }),
    );
    vi.stubGlobal("fetch", request);
    const headers = { "x-anonymous-subject-id": "591f2e90-996a-50c5-af46-967dd0793000" };

    expect(
      (
        await loadInterestProfile(
          new NextRequest("https://whichone.site/api/mobile/v1/interest-profile", { headers }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await saveInterestProfile(
          new NextRequest("https://whichone.site/api/mobile/v1/interest-profile", {
            method: "PUT",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              onboardingState: "COMPLETED",
              selectedCardCodes: ["FOOD", "GAME", "TECH"],
            }),
          }),
        )
      ).status,
    ).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/interest-profile"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-anonymous-subject-id": headers["x-anonymous-subject-id"],
        }),
      }),
    );
  });

  it("keeps the Analytics secret inside the mobile BFF", async () => {
    vi.stubEnv("AUTH_INTERNAL_SECRET", "mobile-analytics-secret");
    const request = vi.fn(async () => jsonResponse({ accepted: true, duplicate: false }));
    vi.stubGlobal("fetch", request);
    const sessionId = "591f2e90-996a-50c5-af46-967dd0793000";

    const response = await recordAnalyticsEvent(
      new NextRequest("https://whichone.site/api/mobile/v1/analytics/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-analytics-session-id": sessionId,
        },
        body: JSON.stringify({
          eventId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          eventType: "INTEREST_PROMPT_VIEW",
          issueId: "8c092a45-c446-50f3-b1ac-ac9a018b9105",
          issueVersion: 1,
          occurredAt: "2026-08-21T00:00:00.000Z",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/internal/analytics/events"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-internal-auth-secret": "mobile-analytics-secret",
        }),
        body: expect.stringContaining(`"sessionId":"${sessionId}"`),
      }),
    );
  });
});

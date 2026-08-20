import { describe, expect, it, vi } from "vitest";

import { createMobileApiClient, MobileApiError, type RequestFunction } from "./mobile-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mobile API client", () => {
  it("sends the stored Guest Subject when loading the feed", async () => {
    const request = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }));
    const api = createMobileApiClient({ baseUrl: "https://whichone.site/", request });

    await api.loadFeed(
      "591f2e90-996a-50c5-af46-967dd0793000",
      12,
      "93831fba-b70f-598a-88f6-92eb4f70df9c",
    );

    expect(request).toHaveBeenCalledWith(
      "https://whichone.site/api/mobile/v1/issues/feed?limit=12&excludeIssueId=93831fba-b70f-598a-88f6-92eb4f70df9c",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-anonymous-subject-id": "591f2e90-996a-50c5-af46-967dd0793000",
        }),
      }),
    );
  });

  it("keeps the caller's idempotency key on a Vote request", async () => {
    let capturedInit: RequestInit | undefined;
    const request: RequestFunction = vi.fn(async (_input, init) => {
      capturedInit = init;
      return jsonResponse({
        outcome: "ACCEPTED",
        voteAttemptId: "1",
        voteId: "2",
        issueId: "issue",
        issueVersion: 1,
        choice: "A",
        result: { acceptedA: 1, acceptedB: 0, displayedTotal: 1, resultVersion: 2 },
      });
    });
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await api.submitGuestVote({
      subjectId: "591f2e90-996a-50c5-af46-967dd0793000",
      issueId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
      issueVersion: 1,
      choiceId: "8c092a45-c446-50f3-b1ac-ac9a018b9105",
      idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
    });

    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
    });
  });

  it("surfaces the server error code", async () => {
    const api = createMobileApiClient({
      request: async () =>
        jsonResponse({ code: "GUEST_SUBJECT_NOT_FOUND", message: "다시 준비해야 합니다." }, 404),
    });

    await expect(api.loadIssue("missing")).rejects.toEqual(
      expect.objectContaining<Partial<MobileApiError>>({
        code: "GUEST_SUBJECT_NOT_FOUND",
        status: 404,
      }),
    );
  });

  it("uses one Guest contract for loading and saving Interest Profile", async () => {
    const requests: { input: string; init?: RequestInit }[] = [];
    const request: RequestFunction = vi.fn(async (input, init) => {
      requests.push({ input, init });
      return jsonResponse({
        taxonomyVersion: "interest_cards_v1",
        onboardingState: init?.method === "PUT" ? "COMPLETED" : "NOT_STARTED",
        selectedCardCodes: init?.method === "PUT" ? ["FOOD", "GAME", "TECH"] : [],
        canSkip: true,
        profileVersion: 1,
        mergeCandidate: null,
      });
    });
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });
    const subjectId = "591f2e90-996a-50c5-af46-967dd0793000";

    await api.loadInterestProfile(subjectId);
    await api.saveInterestProfile({
      subjectId,
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
    });

    expect(requests.map((item) => item.input)).toEqual([
      "https://whichone.site/api/mobile/v1/interest-profile",
      "https://whichone.site/api/mobile/v1/interest-profile",
    ]);
    expect(new Headers(requests[0]?.init?.headers).get("x-anonymous-subject-id")).toBe(subjectId);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
    });
  });

  it("treats the stored duplicate Vote response as a completed result", async () => {
    const api = createMobileApiClient({
      request: async () =>
        jsonResponse(
          {
            outcome: "REJECTED_DUPLICATE",
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
          409,
        ),
    });

    await expect(
      api.submitGuestVote({
        subjectId: "8c092a45-c446-50f3-b1ac-ac9a018b9105",
        issueId: "591f2e90-996a-50c5-af46-967dd0793000",
        issueVersion: 1,
        choiceId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
        idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
      }),
    ).resolves.toMatchObject({ outcome: "REJECTED_DUPLICATE", choice: "A" });
  });

  it("sends Interest Prompt Analytics with a native session ID", async () => {
    const request = vi.fn(async () => jsonResponse({ accepted: true, duplicate: false }));
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await api.recordAnalyticsEvent({
      sessionId: "591f2e90-996a-50c5-af46-967dd0793000",
      eventId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
      eventType: "INTEREST_PROMPT_VIEW",
      issueId: "8c092a45-c446-50f3-b1ac-ac9a018b9105",
      issueVersion: 1,
      occurredAt: "2026-08-21T00:00:00.000Z",
    });

    expect(request).toHaveBeenCalledWith(
      "https://whichone.site/api/mobile/v1/analytics/events",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-analytics-session-id": "591f2e90-996a-50c5-af46-967dd0793000",
        }),
      }),
    );
  });
});

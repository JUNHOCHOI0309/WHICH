import { describe, expect, it, vi } from "vitest";

import { createMobileApiClient, MobileApiError, type RequestFunction } from "./mobile-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mobile API client", () => {
  it("loads the authenticated Member profile and vote history", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        member: {
          id: "591f2e90-996a-50c5-af46-967dd0793000",
          displayName: "Native Member",
          status: "ACTIVE",
          avatar: { kind: "INITIALS", initials: "NM" },
          avatarSource: "INITIALS",
          joinedAt: "2026-08-01T00:00:00.000Z",
          participationCount: 1,
        },
        publicProfile: null,
        identities: [],
        votes: { items: [], nextCursor: null },
      }),
    );
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await expect(api.loadMemberProfile("member-session", { limit: 5 })).resolves.toMatchObject({
      member: { displayName: "Native Member", participationCount: 1 },
    });
    expect(request).toHaveBeenCalledWith(
      "https://whichone.site/api/mobile/v1/me?limit=5",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer member-session" }),
      }),
    );
  });

  it("uses the same authenticated W Point contract as the web Member view", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        account: {
          balance: 20,
          todayEarned: 10,
          lifetimeEarned: 20,
          lifetimeSpent: 0,
          hasPendingRecovery: false,
        },
        ledger: { items: [], nextCursor: null },
      }),
    );
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await expect(api.loadMemberPoints("member-session", { limit: 5 })).resolves.toMatchObject({
      account: { balance: 20, todayEarned: 10 },
    });
    expect(request).toHaveBeenCalledWith(
      "https://whichone.site/api/mobile/v1/me/points?limit=5",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer member-session" }),
      }),
    );
  });

  it("updates profile settings and deletes the authenticated Member through mobile BFF routes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          displayName: "새 닉네임",
          handle: "native_member",
          bio: "소개",
          visibility: "PUBLIC",
          publicUrl: "/profiles/native_member",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await api.updateMemberProfile("member-session", {
      displayName: "새 닉네임",
      handle: "native_member",
      bio: "소개",
      visibility: "PUBLIC",
    });
    await api.deleteMemberAccount("member-session", "password");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://whichone.site/api/mobile/v1/me/profile",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ authorization: "Bearer member-session" }),
      }),
    );
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      password: "password",
      confirmation: "DELETE",
    });
  });

  it("exchanges, validates, refreshes, and revokes a Native Member session", async () => {
    const member = {
      id: "591f2e90-996a-50c5-af46-967dd0793000",
      displayName: "Native Member",
      status: "ACTIVE" as const,
      avatar: { kind: "INITIALS" as const, initials: "NM" },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ token: "session", expiresAt: "2026-09-01T00:00:00.000Z", member }, 201),
      )
      .mockResolvedValueOnce(jsonResponse({ expiresAt: "2026-09-01T00:00:00.000Z", member }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "rotated", expiresAt: "2026-09-02T00:00:00.000Z", member }, 201),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createMobileApiClient({ baseUrl: "https://which.test", request });

    await api.exchangeMobileSession({
      ticket: "ticket",
      codeVerifier: "verifier",
      state: "state",
      nonce: "nonce",
      anonymousSubjectId: "591f2e90-996a-50c5-af46-967dd0793000",
    });
    await api.loadMemberSession("session");
    await api.refreshMemberSession("session");
    await api.revokeMemberSession("rotated");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://which.test/api/mobile/v1/mobile-auth/member-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "https://which.test/api/mobile/v1/member-session",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

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

  it("submits and restores a Vote with the Native Member session", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          outcome: "ACCEPTED",
          voteAttemptId: "1",
          voteId: "2",
          issueId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          issueVersion: 1,
          choice: "A",
          result: { acceptedA: 1, acceptedB: 0, displayedTotal: 1, resultVersion: 2 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          outcome: "ACCEPTED",
          voteAttemptId: "1",
          voteId: "2",
          issueId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          issueVersion: 1,
          choice: "A",
          result: { acceptedA: 1, acceptedB: 0, displayedTotal: 1, resultVersion: 2 },
        }),
      );
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });

    await api.submitGuestVote({
      sessionToken: "member-session",
      issueId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
      issueVersion: 1,
      choiceId: "8c092a45-c446-50f3-b1ac-ac9a018b9105",
      idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
    });
    await api.loadMemberVote("member-session", "93831fba-b70f-598a-88f6-92eb4f70df9c");

    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer member-session",
    );
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer member-session",
    );
  });

  it("loads both A/B comment highlights with the accepted Guest Subject", async () => {
    const request = vi.fn(async () => jsonResponse({ A: [], B: [] }));
    const api = createMobileApiClient({ baseUrl: "https://whichone.site", request });
    const subjectId = "591f2e90-996a-50c5-af46-967dd0793000";
    const issueId = "93831fba-b70f-598a-88f6-92eb4f70df9c";

    await api.loadCommentHighlights(subjectId, issueId);

    expect(request).toHaveBeenCalledWith(
      `https://whichone.site/api/mobile/v1/issues/${issueId}/comment-highlights`,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-anonymous-subject-id": subjectId }),
      }),
    );
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

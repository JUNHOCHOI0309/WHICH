import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as createSubject } from "@/app/api/mobile/v1/guest-subjects/route";
import { POST as recordAnalyticsEvent } from "@/app/api/mobile/v1/analytics/events/route";
import {
  GET as loadInterestProfile,
  PUT as saveInterestProfile,
} from "@/app/api/mobile/v1/interest-profile/route";
import { POST as mergeInterestProfile } from "@/app/api/mobile/v1/interest-profile/merge/route";
import { GET as loadFeed } from "@/app/api/mobile/v1/issues/feed/route";
import { GET as loadCommentHighlights } from "@/app/api/mobile/v1/issues/[issueId]/comment-highlights/route";
import { POST as submitVote } from "@/app/api/mobile/v1/issues/[issueId]/votes/route";
import { GET as loadMemberVote } from "@/app/api/mobile/v1/me/votes/[issueId]/route";
import { DELETE as deleteMember, GET as loadMemberProfile } from "@/app/api/mobile/v1/me/route";
import { PATCH as updateMemberProfile } from "@/app/api/mobile/v1/me/profile/route";
import { DELETE as deleteMemberAvatar } from "@/app/api/mobile/v1/me/avatar/route";
import { GET as loadMemberModeration } from "@/app/api/mobile/v1/me/moderation/route";
import { POST as submitModerationAppeal } from "@/app/api/mobile/v1/me/moderation/appeals/route";
import { POST as submitModerationRights } from "@/app/api/mobile/v1/me/moderation/rights/route";
import { POST as chooseModerationAlternative } from "@/app/api/mobile/v1/me/moderation/submissions/[submissionId]/asset-alternative/route";
import { POST as exchangeMobileSession } from "@/app/api/mobile/v1/mobile-auth/member-sessions/route";
import {
  DELETE as revokeMobileSession,
  GET as loadMobileSession,
  POST as refreshMobileSession,
} from "@/app/api/mobile/v1/member-session/route";

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
  it("requires a Native Member Bearer session for protected profile surfaces", async () => {
    const profile = await loadMemberProfile(
      new NextRequest("https://whichone.site/api/mobile/v1/me"),
    );
    const avatar = await deleteMemberAvatar(
      new NextRequest("https://whichone.site/api/mobile/v1/me/avatar", { method: "DELETE" }),
    );

    expect(profile.status).toBe(401);
    expect(avatar.status).toBe(401);
  });

  it("requires a Native Member Bearer session for the moderation center", async () => {
    const response = await loadMemberModeration(
      new NextRequest("https://whichone.site/api/mobile/v1/me/moderation"),
    );

    expect(response.status).toBe(401);
  });

  it("proxies native moderation reads and Member actions with the Bearer session", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: 1,
          generatedAt: "2026-08-29T00:00:00.000Z",
          assets: [],
          libraryAssets: [],
          notices: [],
          appeals: [],
          rightsCases: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "appeal-1", status: "SUBMITTED" }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: "rights-1", status: "SUBMITTED" }, 201))
      .mockResolvedValueOnce(jsonResponse({ updated: true, revision: 2 }));
    vi.stubGlobal("fetch", request);
    const authorization = "Bearer native-member-session";

    await loadMemberModeration(
      new NextRequest("https://whichone.site/api/mobile/v1/me/moderation", {
        headers: { authorization },
      }),
    );
    await submitModerationAppeal(
      new NextRequest("https://whichone.site/api/mobile/v1/me/moderation/appeals", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ targetType: "ISSUE_MEDIA_ASSET", targetId: "asset-1" }),
      }),
    );
    await submitModerationRights(
      new NextRequest("https://whichone.site/api/mobile/v1/me/moderation/rights", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ requestType: "COPYRIGHT", targetId: "asset-1" }),
      }),
    );
    await chooseModerationAlternative(
      new NextRequest(
        "https://whichone.site/api/mobile/v1/me/moderation/submissions/submission-1/asset-alternative",
        {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ action: "TEXT_ONLY" }),
        },
      ),
      { params: Promise.resolve({ submissionId: "submission-1" }) },
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL("http://localhost:4000/v1/me/moderation"),
      expect.objectContaining({ headers: expect.objectContaining({ authorization }) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      new URL("http://localhost:4000/v1/me/moderation/submissions/submission-1/asset-alternative"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("proxies Native profile edits and account deletion with the Bearer session", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          displayName: "새 닉네임",
          handle: "native_member",
          bio: null,
          visibility: "PRIVATE",
          publicUrl: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    vi.stubGlobal("fetch", request);
    const authorization = "Bearer native-member-session";

    const profileResponse = await updateMemberProfile(
      new NextRequest("https://whichone.site/api/mobile/v1/me/profile", {
        method: "PATCH",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "새 닉네임",
          handle: "native_member",
          bio: null,
          visibility: "PRIVATE",
        }),
      }),
    );
    const deleteResponse = await deleteMember(
      new NextRequest("https://whichone.site/api/mobile/v1/me", {
        method: "DELETE",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ password: "password", confirmation: "DELETE" }),
      }),
    );

    expect(profileResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL("http://localhost:4000/v1/me/profile"),
      expect.objectContaining({ headers: expect.objectContaining({ authorization }) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL("http://localhost:4000/v1/me"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("proxies Native session exchange and lifecycle without internal secrets", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ token: "native-session", expiresAt: "2026-09-01T00:00:00.000Z" }, 201),
      )
      .mockResolvedValueOnce(jsonResponse({ expiresAt: "2026-09-01T00:00:00.000Z" }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "rotated-session", expiresAt: "2026-09-02T00:00:00.000Z" }, 201),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);

    await exchangeMobileSession(
      new NextRequest("https://whichone.site/api/mobile/v1/mobile-auth/member-sessions", {
        method: "POST",
        body: JSON.stringify({ ticket: "ticket" }),
      }),
    );
    const sessionRequest = (method: "GET" | "POST" | "DELETE") =>
      new NextRequest("https://whichone.site/api/mobile/v1/member-session", {
        method,
        headers: { authorization: "Bearer native-session" },
      });
    await loadMobileSession(sessionRequest("GET"));
    await refreshMobileSession(sessionRequest("POST"));
    await revokeMobileSession(sessionRequest("DELETE"));

    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL("http://localhost:4000/v1/mobile-auth/member-sessions"),
      expect.not.objectContaining({
        headers: expect.objectContaining({ "x-internal-auth-secret": expect.anything() }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      new URL("http://localhost:4000/v1/member-session/refresh"),
      expect.objectContaining({ method: "POST" }),
    );
  });

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

  it("rejects a native Vote without a Guest or Member subject", async () => {
    const response = await submitVote(
      new NextRequest(
        "https://whichone.site/api/mobile/v1/issues/591f2e90-996a-50c5-af46-967dd0793000/votes",
        { method: "POST", body: JSON.stringify({}) },
      ),
      { params: Promise.resolve({ issueId: "591f2e90-996a-50c5-af46-967dd0793000" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VOTE_SUBJECT_REQUIRED" });
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

  it("forwards the Native Member session for Vote submission and restoration", async () => {
    const issueId = "591f2e90-996a-50c5-af46-967dd0793000";
    const request = vi.fn(async () =>
      jsonResponse({
        outcome: "ACCEPTED",
        voteAttemptId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
        voteId: "d52dace5-486c-5e34-bb73-5a0b5a779c98",
        issueId,
        issueVersion: 1,
        choice: "A",
        result: { resultVersion: 2, acceptedA: 1, acceptedB: 0, displayedTotal: 1 },
      }),
    );
    vi.stubGlobal("fetch", request);
    const authorization = "Bearer native-member-session";

    const voteResponse = await submitVote(
      new NextRequest(`https://whichone.site/api/mobile/v1/issues/${issueId}/votes`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          issueVersion: 1,
          choiceId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          idempotencyKey: "ce976502-9409-56a2-b975-94c913a20fcf",
        }),
      }),
      { params: Promise.resolve({ issueId }) },
    );
    const restoreResponse = await loadMemberVote(
      new NextRequest(`https://whichone.site/api/mobile/v1/me/votes/${issueId}`, {
        headers: { authorization },
      }),
      { params: Promise.resolve({ issueId }) },
    );

    expect(voteResponse.status).toBe(200);
    expect(restoreResponse.status).toBe(200);
    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL(`http://localhost:4000/v1/issues/${issueId}/votes`),
      expect.objectContaining({ headers: expect.objectContaining({ authorization }) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL(`http://localhost:4000/v1/me/votes/${issueId}`),
      expect.objectContaining({ headers: expect.objectContaining({ authorization }) }),
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

  it("forwards Native Member interest reads and an idempotent Guest merge", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        taxonomyVersion: "interest_cards_v1",
        onboardingState: "COMPLETED",
        selectedCardCodes: ["FOOD", "GAME", "TECH"],
        canSkip: false,
        profileVersion: 2,
        mergeCandidate: null,
      }),
    );
    vi.stubGlobal("fetch", request);
    const authorization = "Bearer native-member-session";
    const anonymousSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";

    const profileResponse = await loadInterestProfile(
      new NextRequest("https://whichone.site/api/mobile/v1/interest-profile", {
        headers: { authorization, "x-anonymous-subject-id": anonymousSubjectId },
      }),
    );
    const mergeResponse = await mergeInterestProfile(
      new NextRequest("https://whichone.site/api/mobile/v1/interest-profile/merge", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ anonymousSubjectId, selectedCardCodes: ["FOOD"] }),
      }),
    );

    expect(profileResponse.status).toBe(200);
    expect(mergeResponse.status).toBe(200);
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL("http://localhost:4000/v1/interest-profile/merge"),
      expect.objectContaining({ headers: expect.objectContaining({ authorization }) }),
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

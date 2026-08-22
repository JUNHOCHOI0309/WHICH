import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as readProfile, PUT as saveProfile } from "@/app/api/interest-profile/route";
import { POST as resetProfile } from "@/app/api/interest-profile/reset/route";
import { GUEST_SUBJECT_COOKIE, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

const GUEST_ID = "591f2e90-996a-50c5-af46-967dd0793000";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Interest Profile BFF", () => {
  it("creates a Guest Subject for a direct settings visit and stores its cookie", async () => {
    const request = vi.fn(async (input: URL) => {
      if (input.pathname === "/v1/guest-subjects") {
        return jsonResponse({ anonymousSubjectId: GUEST_ID }, 201);
      }
      return jsonResponse({
        taxonomyVersion: "interest_cards_v1",
        onboardingState: "NOT_STARTED",
        selectedCardCodes: [],
        canSkip: true,
        profileVersion: 1,
        mergeCandidate: null,
      });
    });
    vi.stubGlobal("fetch", request);

    const response = await readProfile(
      new NextRequest("https://whichone.site/api/interest-profile"),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(GUEST_SUBJECT_COOKIE)?.value).toBe(GUEST_ID);
    expect(request).toHaveBeenLastCalledWith(
      new URL("http://localhost:4000/v1/interest-profile"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-anonymous-subject-id": GUEST_ID }),
      }),
    );
  });

  it("forwards both Member and linked Guest identities without exposing cookies", async () => {
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
    const headers = new Headers({
      cookie: `${MEMBER_SESSION_COOKIE}=member-token; ${GUEST_SUBJECT_COOKIE}=${GUEST_ID}`,
    });

    const response = await saveProfile(
      new NextRequest("https://whichone.site/api/interest-profile", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          onboardingState: "COMPLETED",
          selectedCardCodes: ["FOOD", "GAME", "TECH"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/interest-profile"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer member-token",
          "x-anonymous-subject-id": GUEST_ID,
        }),
      }),
    );
  });

  it("uses the same identity boundary for reset", async () => {
    const request = vi.fn(async () => jsonResponse({ onboardingState: "RESET" }));
    vi.stubGlobal("fetch", request);

    const response = await resetProfile(
      new NextRequest("https://whichone.site/api/interest-profile/reset", {
        method: "POST",
        headers: { cookie: `${GUEST_SUBJECT_COOKIE}=${GUEST_ID}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/interest-profile/reset"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-anonymous-subject-id": GUEST_ID }),
      }),
    );
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as readMe } from "@/app/api/me/route";
import { GET as readVoteStatus } from "@/app/api/issues/[issueId]/vote-status/route";

const ISSUE_ID = "591f2e90-996a-50c5-af46-967dd0793000";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Member private profile BFF routes", () => {
  it("forwards only the HttpOnly Member session to the private profile API", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/me?limit=5");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      return new Response(JSON.stringify({ member: {}, votes: { items: [], nextCursor: null } }));
    });
    vi.stubGlobal("fetch", upstream);

    const response = await readMe(
      new NextRequest("https://whichone.site/api/me?limit=5", {
        headers: { cookie: "which_member_session=member-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("restores a Member vote before falling back to the Guest cookie", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`http://localhost:4000/v1/me/votes/${ISSUE_ID}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      return new Response(
        JSON.stringify({
          outcome: "ACCEPTED",
          voteAttemptId: "attempt-1",
          voteId: "vote-1",
          issueId: ISSUE_ID,
          issueVersion: 1,
          choice: "B",
          result: {
            resultVersion: 1,
            acceptedA: 1,
            acceptedB: 2,
            displayedTotal: 3,
            integrityState: "NORMAL",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", upstream);

    const response = await readVoteStatus(
      new NextRequest(`https://whichone.site/api/issues/${ISSUE_ID}/vote-status`, {
        headers: {
          cookie: `which_member_session=member-token; which_guest_subject=${ISSUE_ID}`,
        },
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choice: "B" });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

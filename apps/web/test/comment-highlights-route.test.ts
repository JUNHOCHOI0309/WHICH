import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as loadCommentHighlights } from "@/app/api/issues/[issueId]/comment-highlights/route";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Web comment highlight route", () => {
  it("forwards the Guest cookie to the representative Comment API", async () => {
    const request = vi.fn(async () => jsonResponse({ A: [], B: [] }));
    vi.stubGlobal("fetch", request);
    const subjectId = "8c092a45-c446-50f3-b1ac-ac9a018b9105";
    const issueId = "591f2e90-996a-50c5-af46-967dd0793000";

    const response = await loadCommentHighlights(
      new NextRequest(`https://whichone.site/api/issues/${issueId}/comment-highlights`, {
        headers: { cookie: `which_guest_subject=${subjectId}` },
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
});

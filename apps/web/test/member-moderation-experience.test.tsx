import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberModerationExperience } from "@/features/identity/member-moderation-experience";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function center() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-29T00:00:00.000Z",
    libraryAssets: [],
    assets: [
      {
        assetId: "36c2fb60-8c40-42a0-89c1-478451fb5e2e",
        issueSubmission: {
          id: "dd353808-7318-45a5-83f0-91a04143322e",
          question: "이미지를 기다리는 동안 질문을 계속할까요?",
          publicationStatus: "PENDING",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
        assetReview: {
          status: "PENDING",
          policyVersion: "issue-media-review-v1",
          reasonCode: "AWAITING_REVIEW",
          action: "REVIEW",
          submittedAt: "2026-08-29T00:00:00.000Z",
          lastChangedAt: "2026-08-29T00:00:00.000Z",
        },
        alternatives: ["TEXT_ONLY", "APPROVED_LIBRARY", "REPLACE_IMAGE", "CANCEL_IMAGE"],
        appealId: null,
      },
    ],
    notices: [
      {
        id: "notice-1",
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: "36c2fb60-8c40-42a0-89c1-478451fb5e2e",
        policyVersion: "member-moderation-v1",
        reasonCode: "APPEAL_SUBMITTED",
        actionType: "HUMAN_REVIEW",
        summary: "재검토 요청을 접수했습니다.",
        nextStep: "사람 검토가 끝나면 최종 결과를 확인할 수 있습니다.",
        effectiveAt: "2026-08-29T00:00:00.000Z",
        expiresAt: null,
        readAt: null,
        createdAt: "2026-08-29T00:00:00.000Z",
      },
    ],
    appeals: [],
    rightsCases: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Member moderation experience", () => {
  it("shows separate states and links submission management without duplicate forms", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("asset-alternative")) return response({ updated: true, revision: 2 });
        return response(center());
      }),
    );

    render(<MemberModerationExperience />);

    expect(await screen.findByRole("heading", { name: "이미지와 질문 상태" })).toBeVisible();
    expect(screen.getByText("이미지를 기다리는 동안 질문을 계속할까요?")).toBeVisible();
    expect(screen.getByText("Issue 게시").parentElement).toHaveTextContent("검수 대기");
    expect(screen.getByText("Asset 검수").parentElement).toHaveTextContent("검수 대기");
    expect(screen.getByText("재검토 요청을 접수했습니다.")).toBeVisible();

    expect(screen.getByRole("link", { name: "내 질문에서 게시 상태 확인·수정" })).toHaveAttribute(
      "href",
      "/me/submissions",
    );
    expect(screen.queryByLabelText("권리 확인")).not.toBeInTheDocument();
  });

  it("does not expose the private moderation center to a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ code: "SESSION_INVALID" }, 401)),
    );
    render(<MemberModerationExperience />);
    expect(
      await screen.findByRole("heading", {
        name: "로그인하면 내 Moderation 상태를 확인할 수 있어요.",
      }),
    ).toBeVisible();
    expect(
      screen
        .getAllByRole("link", { name: "로그인" })
        .find((link) => link.getAttribute("href") === "/login?returnTo=%2Fme%2Fmoderation"),
    ).toBeDefined();
  });
});

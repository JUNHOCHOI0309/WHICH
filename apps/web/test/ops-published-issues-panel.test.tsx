import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsPublishedIssuesPanel } from "@/features/operations/ops-published-issues-panel";

const issue = {
  issueId: "10503719-4d3b-4abf-a1ee-ec0920d72e9a",
  version: 1,
  question: "운영 화면에서 관리할 질문은?",
  context: "게시된 질문 관리 테스트",
  choices: [
    { code: "A" as const, label: "계속 공개" },
    { code: "B" as const, label: "노출 중지" },
  ],
  categoryCode: "LIFE",
  mediaMode: "TEXT_ONLY",
  author: {
    memberId: "20503719-4d3b-4abf-a1ee-ec0920d72e9a",
    displayName: "question-maker",
  },
  lifecycle: "PUBLISHED",
  visibility: "VISIBLE",
  participation: "VOTING_OPEN",
  feedEligibility: "ELIGIBLE",
  state: "ACTIVE" as "ACTIVE" | "HIDDEN",
  acceptedVotes: 24,
  reportCount: 2,
  publishedAt: "2026-09-02T01:00:00.000Z",
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T01:00:00.000Z",
};

function pageResponse() {
  return new Response(
    JSON.stringify({ schemaVersion: 1, generatedAt: "2026-09-02T02:00:00.000Z", items: [issue] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Ops published Issue controls", () => {
  it("hides an active Issue with an audited reason and keeps success feedback visible", async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          action: "HIDE",
          expectedUpdatedAt: "2026-09-02T01:00:00.000Z",
          reason: "신고 내용을 확인할 때까지 노출을 중지합니다.",
        });
        issue.state = "HIDDEN";
        issue.visibility = "SUSPENDED";
        issue.participation = "VOTING_SUSPENDED";
        issue.feedEligibility = "EXCLUDED";
        issue.updatedAt = "2026-09-02T02:00:00.000Z";
        return new Response(JSON.stringify(issue), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return pageResponse();
    });
    vi.stubGlobal("fetch", request);

    render(<OpsPublishedIssuesPanel />);

    expect(await screen.findByRole("heading", { name: issue.question })).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("운영 조치 사유 (10자 이상)"), {
      target: { value: "신고 내용을 확인할 때까지 노출을 중지합니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "노출 중지" }));

    expect(await screen.findByText("노출 중지 조치를 기록했습니다.")).toBeVisible();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.getByText("SUSPENDED")).toBeVisible();
  });
});

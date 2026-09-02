import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsPublishedIssuesPanel } from "@/features/operations/ops-published-issues-panel";
import type { OpsPublishedIssue } from "@/features/operations/contracts";

const issue: OpsPublishedIssue = {
  issueId: "10503719-4d3b-4abf-a1ee-ec0920d72e9a",
  version: 1,
  question: "운영 화면에서 관리할 질문은?",
  context: "게시된 질문 관리 테스트",
  choices: [
    {
      id: "30503719-4d3b-4abf-a1ee-ec0920d72e9a",
      code: "A" as const,
      label: "계속 공개",
      media: null,
    },
    {
      id: "40503719-4d3b-4abf-a1ee-ec0920d72e9a",
      code: "B" as const,
      label: "노출 중지",
      media: null,
    },
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
  state: "ACTIVE",
  acceptedVotes: 24,
  reportCount: 2,
  activeReportReview: null,
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
    fireEvent.change(screen.getByPlaceholderText("운영 조치 사유"), {
      target: { value: "신고 내용을 확인할 때까지 노출을 중지합니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "노출 중지" }));

    expect(await screen.findByText("노출 중지 조치를 기록했습니다.")).toBeVisible();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.getByText("SUSPENDED")).toBeVisible();
  });

  it("uploads and approves every choice image before publishing a media revision", async () => {
    issue.state = "ACTIVE";
    issue.visibility = "VISIBLE";
    issue.participation = "VOTING_OPEN";
    issue.feedEligibility = "ELIGIBLE";
    issue.acceptedVotes = 0;
    issue.updatedAt = "2026-09-02T03:00:00.000Z";
    let uploadCount = 0;
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ops/media-review/assets" && init?.method === "POST") {
        uploadCount += 1;
        return new Response(
          JSON.stringify({
            asset: {
              id: `${uploadCount}0503719-4d3b-4abf-a1ee-ec0920d72e9a`,
              moderationState: "PENDING",
              storageState: "STAGED",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/ops/media-review/assets/") && init?.method === "PUT") {
        return new Response(JSON.stringify({ status: "APPROVED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/ops/published-issues/") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { choices: unknown[] };
        expect(body.choices).toHaveLength(2);
        return new Response(JSON.stringify({ ...issue, version: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return pageResponse();
    });
    vi.stubGlobal("fetch", request);

    render(<OpsPublishedIssuesPanel />);
    await screen.findByRole("heading", { name: issue.question });
    const inputs = screen.getAllByLabelText("이미지 추가");
    fireEvent.change(inputs[0]!, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    fireEvent.change(inputs[1]!, {
      target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByPlaceholderText("새 이미지 권리 근거 (직접 촬영·라이선스 등)"), {
      target: { value: "운영자가 직접 제작하고 사용 권리를 확인한 이미지입니다." },
    });
    fireEvent.change(screen.getByPlaceholderText("이미지 수정 사유"), {
      target: { value: "기본 질문에 A/B 선택지 이미지를 추가합니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "이미지 수정본 공개" }));

    expect(await screen.findByText("이미지를 적용한 v2 수정본을 공개했습니다.")).toBeVisible();
    expect(uploadCount).toBe(2);
    expect(request).toHaveBeenCalledTimes(7);
  });

  it("shows report details and dismisses an active report case with a short reason", async () => {
    issue.state = "ACTIVE";
    issue.activeReportReview = {
      caseId: "50503719-4d3b-4abf-a1ee-ec0920d72e9a",
      status: "PENDING_REVIEW",
      priority: "P0",
      automationRecommendation: "P0_REVIEW",
      policyVersion: "report-signal-v2",
      reportCount: 1,
      reports: [
        {
          id: "60503719-4d3b-4abf-a1ee-ec0920d72e9a",
          reasonCode: "HATE",
          detail: "선택지 표현이 특정 집단을 비하합니다.",
          reporterKind: "MEMBER",
          weight: 1,
          createdAt: "2026-09-02T03:10:00.000Z",
        },
      ],
      createdAt: "2026-09-02T03:10:00.000Z",
      updatedAt: "2026-09-02T03:10:00.000Z",
    };
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          action: "DISMISS_REPORTS",
          expectedReportCaseId: "50503719-4d3b-4abf-a1ee-ec0920d72e9a",
          expectedReportUpdatedAt: "2026-09-02T03:10:00.000Z",
          reason: "오탐",
        });
        issue.activeReportReview = null;
        return new Response(JSON.stringify(issue), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return pageResponse();
    });
    vi.stubGlobal("fetch", request);

    render(<OpsPublishedIssuesPanel />);
    expect(await screen.findByText("혐오 표현")).toBeVisible();
    expect(screen.getByText("선택지 표현이 특정 집단을 비하합니다.")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("운영 조치 사유"), {
      target: { value: "오탐" },
    });
    fireEvent.click(screen.getByRole("button", { name: "신고 기각" }));

    expect(await screen.findByText("신고 기각 조치를 기록했습니다.")).toBeVisible();
  });
});

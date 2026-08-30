import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { MemberIssueSubmission } from "@/lib/contracts";
import { MemberSubmissionsExperience } from "@/features/issues/member-submissions-experience";

const api = vi.hoisted(() => ({
  loadMemberSubmissions: vi.fn(),
  actOnMemberSubmission: vi.fn(),
  updateMemberSubmission: vi.fn(),
  loadIssueMediaLibrary: vi.fn(),
  uploadIssueSubmissionMedia: vi.fn(),
}));
vi.mock("@/features/issues/issue-creator-client", () => api);
vi.mock("@/components/layout/which-shell", () => ({
  WhichShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/feedback/toast-provider", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
const pending: MemberIssueSubmission = {
  id: "pending",
  revision: 2,
  status: "PENDING",
  publicationState: "PROCESSING",
  publishedIssueId: null,
  question: "주말에는 무엇을 할까요?",
  context: null,
  choiceA: "산책",
  choiceB: "독서",
  interestCardCode: "DAILY_LIFE",
  mediaAssetAId: "a",
  mediaAssetBId: "b",
  reviewNote: null,
  submittedAt: "2026-08-30T00:00:00Z",
  updatedAt: "2026-08-30T00:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  api.loadMemberSubmissions.mockResolvedValue({ items: [pending] });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("member submissions", () => {
  it("converts to text and removes pending controls after publication", async () => {
    api.actOnMemberSubmission.mockResolvedValue({
      submission: {
        ...pending,
        publicationState: "PUBLISHED",
        publishedIssueId: "published",
        status: "APPROVED",
        revision: 3,
      },
    });
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 없이 게시" }));
    await waitFor(() =>
      expect(api.actOnMemberSubmission).toHaveBeenCalledWith(pending, "TEXT_ONLY", undefined),
    );
    expect(await screen.findByRole("link", { name: "게시된 질문 보기 →" })).toHaveAttribute(
      "href",
      "/issues/published",
    );
    expect(screen.queryByRole("button", { name: "제출 취소" })).not.toBeInTheDocument();
  });
  it("preserves both original assets when editing text only", async () => {
    api.updateMemberSubmission.mockResolvedValue({ submission: { ...pending, revision: 3 } });
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "수정·이미지 변경" }));
    fireEvent.change(screen.getByLabelText("질문"), {
      target: { value: "주말에는 어디서 쉬고 싶나요?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정본 제출" }));
    await waitFor(() =>
      expect(api.updateMemberSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 2 }),
        expect.objectContaining({
          question: "주말에는 어디서 쉬고 싶나요?",
          mediaAssetAId: "a",
          mediaAssetBId: "b",
        }),
        expect.any(String),
      ),
    );
    expect(api.uploadIssueSubmissionMedia).not.toHaveBeenCalled();
  });
  it("does not expose mutation controls on cancelled questions", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [{ ...pending, status: "CANCELLED", publicationState: "CANCELLED" }],
    });
    render(<MemberSubmissionsExperience />);
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이미지 없이 게시" })).not.toBeInTheDocument();
  });
  it("shows sign-in instead of private records for guests", async () => {
    api.loadMemberSubmissions.mockRejectedValue({ status: 401 });
    render(<MemberSubmissionsExperience />);
    expect(
      await screen.findByRole("link", { name: "로그인하고 내 질문 보기" }),
    ).toBeInTheDocument();
  });
});

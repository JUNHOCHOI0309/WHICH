import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("uses the shared tabs and compact month groups with real submission states", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [
        pending,
        {
          ...pending,
          id: "older",
          question: "지난달에는 무엇을 골랐나요?",
          submittedAt: "2026-07-20T00:00:00Z",
          status: "CANCELLED",
          publicationState: "CANCELLED",
        },
      ],
    });
    render(<MemberSubmissionsExperience creationEnabled />);
    expect(await screen.findByRole("heading", { name: "2026년 8월" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2026년 7월" })).toBeVisible();
    const navigation = within(screen.getByRole("navigation", { name: "내 기록 메뉴" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "프로필",
      "투표 기록",
      "내 질문",
    ]);
    expect(navigation.getByRole("link", { name: "내 질문" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("처리 중")).toBeVisible();
    expect(screen.getByText("취소됨")).toBeVisible();
    expect(screen.queryByLabelText(/현재 결과/)).not.toBeInTheDocument();
  });
  it("keeps management collapsed and closes the editor when collapsed again", async () => {
    render(<MemberSubmissionsExperience creationEnabled />);
    const manage = await screen.findByRole("button", { name: `${pending.question} 관리` });
    expect(manage).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "제출 취소" })).not.toBeInTheDocument();
    fireEvent.click(manage);
    expect(manage).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "수정·이미지 변경" }));
    expect(screen.getByLabelText("질문")).toBeVisible();
    fireEvent.click(manage);
    expect(manage).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("질문")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "제출 취소" })).not.toBeInTheDocument();
  });
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
    fireEvent.click(await screen.findByRole("button", { name: `${pending.question} 관리` }));
    fireEvent.click(await screen.findByRole("button", { name: "이미지 없이 게시" }));
    await waitFor(() =>
      expect(api.actOnMemberSubmission).toHaveBeenCalledWith(pending, "TEXT_ONLY", undefined),
    );
    expect(await screen.findByRole("link", { name: /게시된 질문 보기/ })).toHaveAttribute(
      "href",
      "/issues/published",
    );
    expect(screen.queryByRole("button", { name: "제출 취소" })).not.toBeInTheDocument();
  });
  it("preserves both original assets when editing text only", async () => {
    api.updateMemberSubmission.mockResolvedValue({ submission: { ...pending, revision: 3 } });
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: `${pending.question} 관리` }));
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

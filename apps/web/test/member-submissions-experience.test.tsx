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
  it("shows only the published-question link without review status or controls", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [
        {
          ...pending,
          status: "APPROVED",
          publicationState: "PUBLISHED",
          publishedIssueId: "live",
          reviewNote: "internal review note",
        },
      ],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    const link = within(row).getByRole("link", { name: `${pending.question} 게시된 질문 보기` });
    expect(link).toHaveTextContent(/^↗$/);
    expect(link).toHaveAttribute("href", "/issues/live");
    expect(row).toHaveAttribute("data-published", "true");
    expect(within(row).queryByText("글 바로가기")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(row).queryByText(/수정본|게시 완료|internal review note/),
    ).not.toBeInTheDocument();
  });
  it("automatically exposes failure reasons and five actions, with read-only status refresh", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [
        {
          ...pending,
          status: "NEEDS_CHANGES",
          publicationState: "NEEDS_CHANGES",
          reviewNote: "이미지를 확인하기 어려워요.",
        },
      ],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    expect(within(row).getByText("이미지를 확인하기 어려워요.")).toBeVisible();
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "수정·이미지 변경",
      "이미지 없이 게시",
      "Library로 교체",
      "게시 상태 확인",
      "제출 취소",
    ]);
    fireEvent.click(within(row).getByRole("button", { name: "게시 상태 확인" }));
    await waitFor(() => expect(api.loadMemberSubmissions).toHaveBeenCalledTimes(2));
    expect(api.actOnMemberSubmission).not.toHaveBeenCalled();
  });
  it("does not enable impossible mutations on final rejected submissions", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [{ ...pending, status: "REJECTED", publicationState: "REJECTED" }],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    expect(
      within(row)
        .getAllByRole("button")
        .filter((b) => !(b as HTMLButtonElement).disabled),
    ).toHaveLength(1);
    expect(within(row).getByRole("button", { name: "게시 상태 확인" })).toBeEnabled();
  });
  it("refreshes from the icon beside the note instead of the hero", async () => {
    render(<MemberSubmissionsExperience />);
    const refresh = screen.getByRole("button", { name: "새로고침" });
    expect(refresh).toBeDisabled();
    await screen.findByText(pending.question);
    expect(refresh).toBeEnabled();
    expect(refresh.closest("header")).toBeNull();
    expect(refresh).toHaveTextContent("");
    expect(refresh.querySelector("img")).toHaveAttribute("alt", "");
    expect(refresh.querySelector("img")).toHaveAttribute("width", "22");
    expect(
      within(refresh.parentElement!).getByText(/최근 제출한 질문을 최대 20개까지 보여요/),
    ).toBeVisible();

    let resolveRefresh!: (result: { items: MemberIssueSubmission[] }) => void;
    api.loadMemberSubmissions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    fireEvent.click(refresh);
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(api.loadMemberSubmissions).toHaveBeenCalledTimes(2);
    resolveRefresh({ items: [] });
    expect(await screen.findByText("아직 제출한 질문이 없어요.")).toBeVisible();
    expect(refresh).toBeEnabled();
  });
  it("allows retrying a failed refresh from the same icon", async () => {
    render(<MemberSubmissionsExperience />);
    await screen.findByText(pending.question);
    const refresh = screen.getByRole("button", { name: "새로고침" });
    api.loadMemberSubmissions.mockRejectedValueOnce(new Error("Unavailable"));
    fireEvent.click(refresh);
    expect(await screen.findByRole("alert")).toHaveTextContent("질문을 불러오지 못했어요.");
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(await screen.findByText(pending.question)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
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
    render(<MemberSubmissionsExperience creationEnabled={false} />);
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

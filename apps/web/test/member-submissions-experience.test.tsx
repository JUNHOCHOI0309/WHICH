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
  it("shows a decorative spinner only while processing and removes it for a terminal result", async () => {
    api.loadMemberSubmissions.mockResolvedValueOnce({ items: [pending] }).mockResolvedValue({
      items: [
        {
          ...pending,
          status: "NEEDS_CHANGES",
          publicationState: "NEEDS_CHANGES",
          reviewNote: "확인 필요",
        },
      ],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    expect(within(row).getByText("처리 중").querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await within(row).findByText("수정 필요");
    expect(within(row).queryByText("처리 중")).not.toBeInTheDocument();
    expect(within(row).getByText("수정 필요").querySelector('[aria-hidden="true"]')).toBeNull();
  });
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
    expect(link).toHaveTextContent("");
    expect(link.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/icons/double-chevron.png"),
    );
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
    expect(link).toHaveAttribute("href", "/issues/live");
    expect(row).toHaveAttribute("data-published", "true");
    expect(within(row).queryByText("글 바로가기")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(row).queryByText(/수정본|게시 완료|internal review note/),
    ).not.toBeInTheDocument();
  });
  it("shows the failure warning with primary actions and an overflow menu", async () => {
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
      within(row).getByText("A/B 이미지 중 하나 이상이 게시 기준을 통과하지 못했어요."),
    ).toBeVisible();
    expect(within(row).getByRole("status").querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/icons/ban.png"),
    );
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["이미지 수정", "이미지 없이 게시", "•••더보기"]);
    expect(
      within(row)
        .getByRole("button", { name: "이미지 수정" })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toContain(encodeURIComponent("/icons/pencil.png"));
    const more = within(row).getByRole("button", { name: `${pending.question} 더보기` });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(
      within(row)
        .getAllByRole("menuitem")
        .map((button) => button.textContent),
    ).toEqual(["라이브러리 이미지로 교체", "목록에서 삭제"]);
    expect(
      within(row)
        .getByRole("menuitem", { name: "라이브러리 이미지로 교체" })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toContain(encodeURIComponent("/icons/image.png"));
    expect(
      within(row)
        .getByRole("menuitem", { name: "목록에서 삭제" })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toContain(encodeURIComponent("/icons/delete.png"));
    expect(within(row).queryByText("게시 상태 확인")).not.toBeInTheDocument();
  });
  it("shows an interrupted direct upload as incomplete instead of processing forever", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [
        {
          ...pending,
          id: "incomplete-upload",
          mediaAssetAId: null,
          mediaAssetBId: null,
        },
      ],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    expect(within(row).getByText("업로드 미완료")).toBeVisible();
    expect(within(row).getByText("이미지 업로드를 완료하지 못했어요.")).toBeVisible();
    expect(
      within(row).getByText("이미지 수정을 눌러 필요한 이미지를 다시 선택해 주세요."),
    ).toBeVisible();
    expect(within(row).getByRole("status").querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/icons/attention.png"),
    );
    expect(within(row).queryByText("처리 중")).not.toBeInTheDocument();
  });
  it("allows only list removal on final rejected submissions", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [{ ...pending, status: "REJECTED", publicationState: "REJECTED" }],
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    expect(within(row).queryByRole("button", { name: "이미지 수정" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: `${pending.question} 더보기` }));
    expect(within(row).getByRole("menuitem", { name: "목록에서 삭제" })).toBeEnabled();
    expect(
      within(row).queryByRole("menuitem", { name: "라이브러리 이미지로 교체" }),
    ).not.toBeInTheDocument();
    expect(within(row).queryByText("게시 상태 확인")).not.toBeInTheDocument();
  });
  it("searches questions, context, and choices from the note row", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [
        pending,
        {
          ...pending,
          id: "coffee",
          question: "오늘 마실 커피는?",
          context: "오후 집중 시간",
          choiceA: "라테",
          choiceB: "아메리카노",
        },
      ],
    });
    render(<MemberSubmissionsExperience />);
    const search = await screen.findByRole("searchbox", { name: "내 질문 검색" });
    expect(search.parentElement?.className).toMatch(/noteRow/);
    fireEvent.change(search, { target: { value: "라테" } });
    expect(screen.getByRole("article", { name: "오늘 마실 커피는?" })).toBeVisible();
    expect(screen.queryByRole("article", { name: pending.question })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "없는 검색어" } });
    expect(screen.getByText("검색 결과가 없어요.")).toBeVisible();
  });
  it("removes a failed question from the visible list while preserving it as cancelled", async () => {
    const failed = {
      ...pending,
      status: "REJECTED" as const,
      publicationState: "REJECTED" as const,
    };
    api.loadMemberSubmissions.mockResolvedValue({ items: [failed] });
    api.actOnMemberSubmission.mockResolvedValue({
      submission: { ...failed, revision: 3, status: "CANCELLED", publicationState: "CANCELLED" },
    });
    render(<MemberSubmissionsExperience />);
    const row = await screen.findByRole("article", { name: pending.question });
    fireEvent.click(within(row).getByRole("button", { name: `${pending.question} 더보기` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "목록에서 삭제" }));
    await waitFor(() =>
      expect(api.actOnMemberSubmission).toHaveBeenCalledWith(
        failed,
        "CANCEL",
        undefined,
        undefined,
      ),
    );
    expect(screen.queryByRole("article", { name: pending.question })).not.toBeInTheDocument();
    expect(screen.getByText("아직 제출한 질문이 없어요.")).toBeVisible();
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
    const information = screen.getByRole("button", { name: "내 질문 안내" });
    const tooltip = screen.getByRole("tooltip");
    expect(information).toHaveAttribute("aria-describedby", tooltip.id);
    expect(information.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/icons/help.png"),
    );
    expect(tooltip).toHaveTextContent(/최근 제출한 질문을 최대 20개까지 보여요/);

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
  it("uses the shared tabs and standalone submission cards with real states", async () => {
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
    expect(await screen.findByRole("article", { name: pending.question })).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "지난달에는 무엇을 골랐나요?" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2026년 8월" })).not.toBeInTheDocument();
    expect(screen.getAllByText("DAILY LIFE")).toHaveLength(1);
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
    expect(screen.queryByText("취소됨")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/현재 결과/)).not.toBeInTheDocument();
  });
  it("opens and dismisses the overflow menu while keeping image editing directly accessible", async () => {
    render(<MemberSubmissionsExperience creationEnabled />);
    const more = await screen.findByRole("button", { name: `${pending.question} 더보기` });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "제출 취소" })).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "제출 취소" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "이미지 수정" }));
    expect(screen.getByLabelText("질문")).toBeVisible();
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
    fireEvent.click(await screen.findByRole("button", { name: "이미지 없이 게시" }));
    await waitFor(() =>
      expect(api.actOnMemberSubmission).toHaveBeenCalledWith(
        pending,
        "TEXT_ONLY",
        undefined,
        undefined,
      ),
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
    fireEvent.click(await screen.findByRole("button", { name: "이미지 수정" }));
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
  it("preserves and edits every active choice in a four-choice submission", async () => {
    const fourChoice = {
      ...pending,
      choiceC: "영화",
      choiceD: "게임",
      mediaAssetCId: "c",
      mediaAssetDId: "d",
    };
    api.loadMemberSubmissions.mockResolvedValue({ items: [fourChoice] });
    api.updateMemberSubmission.mockResolvedValue({ submission: { ...fourChoice, revision: 3 } });
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 수정" }));
    fireEvent.change(screen.getByLabelText("C 선택지"), { target: { value: "영화관" } });
    fireEvent.click(screen.getByRole("button", { name: "수정본 제출" }));

    await waitFor(() =>
      expect(api.updateMemberSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 2 }),
        expect.objectContaining({
          choiceC: "영화관",
          choiceD: "게임",
          mediaAssetAId: "a",
          mediaAssetBId: "b",
          mediaAssetCId: "c",
          mediaAssetDId: "d",
        }),
        expect.any(String),
      ),
    );
  });
  it("renders newly added C and D choice fields before they have text", async () => {
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 수정" }));

    fireEvent.click(screen.getByRole("button", { name: "+ 선택지 추가" }));
    expect(screen.getByLabelText("C 선택지")).toBeVisible();

    fireEvent.change(screen.getByLabelText("C 선택지"), { target: { value: "영화" } });
    fireEvent.click(screen.getByRole("button", { name: "+ 선택지 추가" }));
    expect(screen.getByLabelText("D 선택지")).toBeVisible();
  });
  it("selects approved library images individually in A/B/C/D order", async () => {
    const fourChoice = {
      ...pending,
      choiceC: "영화",
      choiceD: "게임",
      mediaAssetCId: "c",
      mediaAssetDId: "d",
    };
    api.loadMemberSubmissions.mockResolvedValue({ items: [fourChoice] });
    api.loadIssueMediaLibrary.mockResolvedValue({
      items: [
        {
          id: "pair-1",
          title: "첫 묶음",
          categoryCode: "LIFE",
          topics: [],
          usageCount: 0,
          assets: [
            { id: "library-1", side: "A", url: "/one.png", altText: "첫 번째 이미지" },
            { id: "library-2", side: "B", url: "/two.png", altText: "두 번째 이미지" },
          ],
        },
        {
          id: "pair-2",
          title: "둘째 묶음",
          categoryCode: "LIFE",
          topics: [],
          usageCount: 0,
          assets: [
            { id: "library-3", side: "A", url: "/three.png", altText: "세 번째 이미지" },
            { id: "library-4", side: "B", url: "/four.png", altText: "네 번째 이미지" },
          ],
        },
      ],
    });
    api.actOnMemberSubmission.mockResolvedValue({
      submission: {
        ...fourChoice,
        publicationState: "PUBLISHED",
        publishedIssueId: "published-four",
      },
    });
    render(<MemberSubmissionsExperience />);
    fireEvent.click(await screen.findByRole("button", { name: `${pending.question} 더보기` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "라이브러리 이미지로 교체" }));
    for (const alt of ["첫 번째 이미지", "세 번째 이미지", "두 번째 이미지", "네 번째 이미지"]) {
      const image = await screen.findByAltText(alt);
      fireEvent.click(image.closest("button")!);
    }
    fireEvent.click(screen.getByRole("button", { name: "선택한 이미지로 게시" }));

    await waitFor(() =>
      expect(api.actOnMemberSubmission).toHaveBeenCalledWith(fourChoice, "LIBRARY", undefined, [
        "library-1",
        "library-3",
        "library-2",
        "library-4",
      ]),
    );
  });
  it("does not expose mutation controls on cancelled questions", async () => {
    api.loadMemberSubmissions.mockResolvedValue({
      items: [{ ...pending, status: "CANCELLED", publicationState: "CANCELLED" }],
    });
    render(<MemberSubmissionsExperience />);
    expect(await screen.findByText("아직 제출한 질문이 없어요.")).toBeInTheDocument();
    expect(screen.queryByText("취소됨")).not.toBeInTheDocument();
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

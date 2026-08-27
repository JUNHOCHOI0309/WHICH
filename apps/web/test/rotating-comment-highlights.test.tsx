import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RotatingCommentHighlights } from "@/components/comments/rotating-comment-highlights";
import type { CommentHighlights, PublicComment } from "@/lib/contracts";

function comment(id: string, choice: "A" | "B", body: string): PublicComment {
  return {
    id,
    choice,
    author: { displayName: `${choice} 작성자` },
    body,
    visibility: "VISIBLE",
    threadState: "OPEN",
    createdAt: "2026-08-24T00:00:00.000Z",
    editedAt: null,
    parentCommentId: null,
    reactions: { helpfulCount: 1, dislikeCount: 0, viewerReaction: null },
    reports: { viewerReported: false, canReport: true },
    permissions: { canEdit: false, canDelete: false },
    replies: [],
  };
}

const highlights: CommentHighlights = {
  A: [comment("a-1", "A", "A 첫 번째"), comment("a-2", "A", "A 두 번째")],
  B: [comment("b-1", "B", "B 첫 번째"), comment("b-2", "B", "B 두 번째")],
};

describe("RotatingCommentHighlights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rotates A/B representative comments together and supports pausing", () => {
    render(
      <RotatingCommentHighlights
        highlights={highlights}
        loading={false}
        error={false}
        detailsHref="/issues/issue#comment-title"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("A 첫 번째")).toBeInTheDocument();
    expect(screen.getByText("B 첫 번째")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("A 두 번째")).toBeInTheDocument();
    expect(screen.getByText("B 두 번째")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("A 두 번째")).toBeInTheDocument();
    expect(screen.getByText("B 두 번째")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 대표 댓글" }));
    expect(screen.getByText("A 첫 번째")).toBeInTheDocument();
  });
});

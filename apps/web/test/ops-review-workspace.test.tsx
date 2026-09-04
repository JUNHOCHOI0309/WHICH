import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/operations/ops-issue-review-panel", () => ({
  OpsIssueReviewPanel: ({ onOpenMediaReview }: { onOpenMediaReview?: () => void }) => (
    <button type="button" onClick={onOpenMediaReview}>
      편집 화면에서 이미지 검수로 이동
    </button>
  ),
}));

vi.mock("@/features/operations/ops-media-review-panel", () => ({
  OpsMediaReviewPanel: ({ onBackToIssues }: { onBackToIssues?: () => void }) => (
    <button type="button" onClick={onBackToIssues}>
      이미지 화면에서 질문 검수로 이동
    </button>
  ),
}));

import { OpsReviewWorkspace } from "@/features/operations/ops-review-workspace";

describe("Ops review workspace", () => {
  it("keeps issue and image review in one review center", () => {
    render(<OpsReviewWorkspace />);

    expect(screen.getByRole("tab", { name: "질문 검수" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "편집 화면에서 이미지 검수로 이동" }));
    expect(screen.getByRole("tab", { name: "이미지 검수" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "이미지 화면에서 질문 검수로 이동" })).toBeVisible();
  });
});

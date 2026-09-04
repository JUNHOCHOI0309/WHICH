import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/operations/ops-issue-review-panel", () => ({
  OpsIssueReviewPanel: () => <div>관리자 질문 검수 화면</div>,
}));

vi.mock("@/features/operations/ops-media-review-panel", () => ({
  OpsMediaReviewPanel: () => <div>사용자 이미지 검수 화면</div>,
}));

import { OpsReviewWorkspace } from "@/features/operations/ops-review-workspace";

describe("Ops review workspace", () => {
  it("keeps issue and image review in one review center", () => {
    render(<OpsReviewWorkspace />);

    expect(screen.getByRole("tab", { name: "질문 검수" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("이미지 업로드·검수로 이동")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "이미지 검수" }));
    expect(screen.getByRole("tab", { name: "이미지 검수" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("사용자 이미지 검수 화면")).toBeVisible();
    expect(screen.queryByText("질문 검수로 돌아가기")).not.toBeInTheDocument();
  });
});

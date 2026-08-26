import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VoteChoiceRow } from "@/components/vote/vote-choice-row";
import type { IssueChoice } from "@/lib/contracts";

const imageChoice: IssueChoice = {
  id: "choice-a",
  code: "A",
  label: "바다로 가기",
  media: {
    url: "https://media.example/choice-a.webp",
    altText: "잔잔한 바다 풍경",
    cropMode: "COVER",
    width: 1200,
    height: 675,
  },
};

describe("VoteChoiceRow media fallback", () => {
  it("keeps the choice label and voting action when an image fails", () => {
    const onSelect = vi.fn();
    const onMediaLoad = vi.fn();
    render(<VoteChoiceRow choice={imageChoice} onSelect={onSelect} onMediaLoad={onMediaLoad} />);

    fireEvent.error(screen.getByAltText("잔잔한 바다 풍경"));
    expect(screen.queryByAltText("잔잔한 바다 풍경")).not.toBeInTheDocument();
    expect(screen.getByText("바다로 가기")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A 선택, 바다로 가기" }));
    expect(onSelect).toHaveBeenCalledWith(imageChoice);
    expect(onMediaLoad).toHaveBeenCalledWith("FAILURE");
  });

  it("reports a successful image load without hiding the text label", () => {
    const onMediaLoad = vi.fn();
    render(<VoteChoiceRow choice={imageChoice} onSelect={vi.fn()} onMediaLoad={onMediaLoad} />);

    fireEvent.load(screen.getByAltText("잔잔한 바다 풍경"));
    expect(screen.getByText("바다로 가기")).toBeInTheDocument();
    expect(onMediaLoad).toHaveBeenCalledWith("SUCCESS");
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceMediaPair, VoteChoiceRow } from "@/components/vote/vote-choice-row";
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
  const originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true;
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
      }),
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    for (const [key, descriptor] of [
      ["showModal", originalShowModal],
      ["close", originalClose],
    ] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
    }
  });
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

  it("opens the entire image without voting or nesting buttons and closes accessibly", () => {
    const onSelect = vi.fn();
    render(<VoteChoiceRow choice={imageChoice} onSelect={onSelect} />);
    const image = screen.getByAltText(imageChoice.media!.altText);
    expect(image).not.toHaveStyle({ objectFit: "cover" });
    expect(image).toHaveAttribute("decoding", "async");
    fireEvent.click(image);
    expect(screen.getByRole("dialog", { name: "이미지 전체 보기" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("button button")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "이미지 확대 닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(screen.getByRole("button", { name: /^A 이미지 확대/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "A 선택, 바다로 가기" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(imageChoice);
  });

  it("supports Escape dismissal and a new image after a failed URL", () => {
    const { rerender } = render(<VoteChoiceRow choice={imageChoice} onSelect={vi.fn()} />);
    fireEvent.error(screen.getByAltText(imageChoice.media!.altText));
    const replacement = {
      ...imageChoice,
      media: { ...imageChoice.media!, url: "https://media.example/new.webp" },
    };
    rerender(<VoteChoiceRow choice={replacement} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByAltText(imageChoice.media!.altText));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByAltText(imageChoice.media!.altText));
    fireEvent.keyDown(screen.getByRole("button", { name: "이미지 확대 닫기" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps preview errors dismissible and restores scrolling on unmount", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(<VoteChoiceRow choice={imageChoice} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByAltText(imageChoice.media!.altText));
    fireEvent.error(screen.getAllByAltText(imageChoice.media!.altText)[1]!);
    expect(screen.getByRole("status")).toHaveTextContent("이미지를 불러오지 못했어요");
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");
    fireEvent.click(screen.getByAltText(imageChoice.media!.altText));
    unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("uses the same preview and source URLs for paired result images", () => {
    render(<ChoiceMediaPair choices={[imageChoice, { ...imageChoice, id: "b", code: "B" }]} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    for (const image of screen.getAllByRole("img"))
      expect(image).toHaveAttribute("src", imageChoice.media!.url);
    fireEvent.click(screen.getByRole("button", { name: /^B 이미지 확대/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

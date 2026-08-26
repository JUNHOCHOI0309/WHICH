import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast, ToastProvider } from "@/components/feedback/toast-provider";

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("ToastProvider", () => {
  it("shows a success message and lets the user dismiss it", () => {
    render(
      <ToastProvider>
        <div>content</div>
      </ToastProvider>,
    );

    act(() => toast.success("저장했어요."));

    expect(screen.getByRole("status")).toHaveTextContent("저장했어요.");
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByText("저장했어요.")).not.toBeInTheDocument();
  });

  it("deduplicates equal messages and keeps at most two notifications", () => {
    render(
      <ToastProvider>
        <div>content</div>
      </ToastProvider>,
    );

    act(() => {
      toast.success("첫 번째");
      toast.success("첫 번째");
      toast.info("두 번째");
      toast.error("세 번째");
    });

    expect(screen.queryByText("첫 번째")).not.toBeInTheDocument();
    expect(screen.getByText("두 번째")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("세 번째");
    expect(screen.getAllByRole("button", { name: "알림 닫기" })).toHaveLength(2);
  });

  it("consumes a flash message after a document navigation", async () => {
    toast.flash({ message: "로그인했어요.", tone: "success" });

    render(
      <ToastProvider>
        <div>content</div>
      </ToastProvider>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("로그인했어요.");
    expect(sessionStorage.getItem("which:toast-flash")).toBeNull();
  });

  it("turns an OAuth success query into a one-time message", async () => {
    window.history.replaceState({}, "", "/me?auth=success");

    render(
      <ToastProvider>
        <div>content</div>
      </ToastProvider>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("로그인했어요.");
    expect(window.location.search).toBe("");
  });
});

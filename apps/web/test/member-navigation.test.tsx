import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhichShell } from "@/components/layout/which-shell";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Member navigation", () => {
  it("offers login and preserves the current page for a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID" }, 401)),
    );
    window.history.replaceState({}, "", "/issues/issue-1");

    render(<WhichShell active="home">내용</WhichShell>);

    await waitFor(() => {
      const links = screen.getAllByRole("link", { name: "로그인" });
      expect(links).toHaveLength(3);
      expect(
        links.every((link) => link.getAttribute("href") === "/login?returnTo=%2Fissues%2Fissue-1"),
      ).toBe(true);
    });
  });

  it("offers private records to an authenticated Member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ member: { id: "member-1", displayName: "테스트 회원", status: "ACTIVE" } }),
      ),
    );

    render(<WhichShell active="home">내용</WhichShell>);

    const links = await screen.findAllByRole("link", { name: "내 기록" });
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.getAttribute("href") === "/me")).toBe(true);
  });
});

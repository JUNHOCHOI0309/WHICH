import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberAccess } from "@/features/identity/member-access";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Issue Member Access logout", () => {
  it("keeps the Member state and shows a retryable error after a failed logout", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          requests.push(init);
          return jsonResponse({ code: "SESSION_REVOKE_FAILED" }, 502);
        }
        return jsonResponse({
          member: { id: "member-1", displayName: "연결 회원", status: "ACTIVE" },
          expiresAt: "2026-08-23T00:00:00.000Z",
        });
      }),
    );

    render(<MemberAccess issueId="issue-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그아웃하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "연결 회원님으로 연결됨" })).toBeVisible();
    expect(screen.getByRole("link", { name: "내 기록 보기" })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(new Headers(requests[0]?.headers).get("x-which-csrf")).toBe("member-session-logout");
  });
});

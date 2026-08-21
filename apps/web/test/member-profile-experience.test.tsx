import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberProfileExperience } from "@/features/identity/member-profile-experience";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Member private profile experience", () => {
  it("explains the private boundary and offers login to a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID", message: "login" }, 401)),
    );

    render(<MemberProfileExperience naverLoginEnabled />);

    expect(await screen.findByText("로그인하면 내 선택이 이어져요.")).toBeVisible();
    expect(screen.getByText(/전체 투표 기록은 다른 사람에게 공개되지 않습니다/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Google로 로그인" })).toHaveAttribute(
      "href",
      "/api/auth/google/start?returnTo=%2Fme",
    );
    expect(screen.getByRole("link", { name: "네이버로 로그인" })).toBeVisible();
  });

  it("shows only the current Member's profile and accepted vote history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          member: {
            id: "member-1",
            displayName: "테스트 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 1,
          },
          votes: {
            items: [
              {
                voteId: "vote-1",
                issueId: "591f2e90-996a-50c5-af46-967dd0793000",
                issueVersion: 1,
                question: "아침형 인간 vs 저녁형 인간",
                categoryCode: "DAILY_LIFE",
                choice: "B",
                choiceLabel: "저녁형 인간",
                acceptedAt: "2026-08-20T09:00:00.000Z",
                result: {
                  resultVersion: 2,
                  acceptedA: 4,
                  acceptedB: 6,
                  displayedTotal: 10,
                  integrityState: "NORMAL",
                },
              },
            ],
            nextCursor: null,
          },
        }),
      ),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);

    expect(await screen.findByRole("heading", { name: "테스트 회원님의 선택" })).toBeVisible();
    expect(screen.getByText("아침형 인간 vs 저녁형 인간")).toBeVisible();
    expect(screen.getByText("저녁형 인간")).toBeVisible();
    expect(screen.getByText("60%")).toBeVisible();
    expect(screen.getByRole("link", { name: /최신 결과 보기/ })).toHaveAttribute(
      "href",
      "/issues/591f2e90-996a-50c5-af46-967dd0793000",
    );
    expect(screen.getByText("선택 기록은 공개 프로필과 분리됩니다.")).toBeVisible();
  });

  it("clears the private view after logout", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), method: init?.method ?? "GET" });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "로그아웃 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(screen.getByText("로그인하면 내 선택이 이어져요.")).toBeVisible());
    expect(requests).toContainEqual({ url: "/api/member-session", method: "DELETE" });
  });
});

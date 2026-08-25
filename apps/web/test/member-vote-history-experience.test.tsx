import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberVoteHistoryExperience } from "@/features/identity/member-vote-history-experience";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function vote(voteId: string, acceptedAt: string, question: string, choice: "A" | "B" = "A") {
  return {
    voteId,
    issueId: "591f2e90-996a-50c5-af46-967dd0793000",
    issueVersion: 1,
    question,
    categoryCode: "DAILY_LIFE",
    choice,
    choiceLabel: choice === "A" ? "바로 하기" : "나중에 하기",
    acceptedAt,
    result: {
      resultVersion: 2,
      acceptedA: 6,
      acceptedB: 4,
      displayedTotal: 10,
      integrityState: "NORMAL",
    },
  };
}

function profile(items: ReturnType<typeof vote>[], nextCursor: string | null) {
  return {
    member: {
      id: "member-1",
      displayName: "기록 회원",
      status: "ACTIVE",
      avatar: { kind: "INITIALS", initials: "기록" },
      avatarSource: "INITIALS",
      joinedAt: "2026-07-01T00:00:00.000Z",
      participationCount: 23,
    },
    publicProfile: null,
    identities: [],
    votes: { items, nextCursor },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Member vote history experience", () => {
  it("groups votes by month and appends the next cursor page", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("cursor=cursor-1")) {
          return jsonResponse(
            profile([vote("vote-3", "2026-07-20T09:00:00.000Z", "휴가는 산 vs 바다")], null),
          );
        }
        return jsonResponse(
          profile(
            [
              vote("vote-1", "2026-08-24T09:00:00.000Z", "바로 할까 나중에 할까"),
              vote("vote-2", "2026-07-30T09:00:00.000Z", "아침 운동 vs 저녁 운동", "B"),
            ],
            "cursor-1",
          ),
        );
      }),
    );

    render(<MemberVoteHistoryExperience />);

    expect(await screen.findByRole("heading", { name: "기록 회원님의 선택 기록" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2026년 8월" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2026년 7월" })).toBeVisible();
    expect(screen.getAllByLabelText("현재 결과 A 60%, B 40%")).toHaveLength(2);
    expect(screen.getByText("A · 바로 하기")).toBeVisible();
    expect(screen.getByRole("link", { name: "투표 기록" })).toHaveAttribute("aria-current", "page");
    expect(requests).toContain("/api/me?limit=20");

    fireEvent.click(screen.getByRole("button", { name: "이전 기록 더 보기" }));

    expect(await screen.findByText("휴가는 산 vs 바다")).toBeVisible();
    await waitFor(() => expect(requests).toContain("/api/me?limit=20&cursor=cursor-1"));
    expect(screen.queryByRole("button", { name: "이전 기록 더 보기" })).not.toBeInTheDocument();
  });

  it("keeps the full history private for a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID" }, 401)),
    );

    render(<MemberVoteHistoryExperience />);

    expect(await screen.findByText("로그인하면 전체 투표 기록을 볼 수 있어요.")).toBeVisible();
    expect(screen.getByRole("link", { name: "로그인 또는 빠른 회원가입" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fme%2Fvotes",
    );
  });
});

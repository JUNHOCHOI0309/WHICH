import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberVoteHistoryExperience } from "@/features/identity/member-vote-history-experience";
import type { ChoiceCode } from "@/lib/contracts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function vote(
  voteId: string,
  acceptedAt: string,
  question: string,
  choice: ChoiceCode = "A",
  choiceCount = 2,
) {
  const labels: Record<ChoiceCode, string> = {
    A: "바로 하기",
    B: "나중에 하기",
    C: "잠깐 쉬기",
    D: "도움 요청하기",
  };
  return {
    voteId,
    issueId: "591f2e90-996a-50c5-af46-967dd0793000",
    issueVersion: 1,
    question,
    categoryCode: "DAILY_LIFE",
    choice,
    choiceLabel: labels[choice],
    choiceCount,
    acceptedAt,
    result: {
      resultVersion: 2,
      acceptedA: 6,
      acceptedB: 4,
      acceptedC: choiceCount >= 3 ? 3 : 0,
      acceptedD: choiceCount >= 4 ? 2 : 0,
      displayedTotal: choiceCount === 4 ? 15 : choiceCount === 3 ? 13 : 10,
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
        if (url.startsWith("/api/me/points")) {
          return jsonResponse({
            account: {
              balance: 120,
              todayEarned: 10,
              lifetimeEarned: 120,
              lifetimeSpent: 0,
              hasPendingRecovery: false,
            },
            badge: {
              policyVersion: "w_badge_v1",
              current: {
                code: "BRONZE",
                label: "브론즈",
                minimumLifetimePoints: 10,
                assetKey: "bronze.webp",
                awardedAt: "2026-08-26T00:00:00.000Z",
              },
              next: {
                code: "SILVER",
                label: "실버",
                minimumLifetimePoints: 1000,
                assetKey: "silver.webp",
              },
              progress: 110 / 990,
            },
            ledger: {
              items: [
                {
                  id: "point-1",
                  entryType: "EARN",
                  amount: 10,
                  reasonCode: "VOTE_ACCEPTED",
                  reasonLabel: "투표 참여",
                  createdAt: "2026-08-26T01:00:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }
        if (url.includes("cursor=cursor-1")) {
          return jsonResponse(
            profile(
              [vote("vote-3", "2026-07-20T09:00:00.000Z", "휴가는 어떤 방식이 좋을까", "D", 4)],
              null,
            ),
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

    render(<MemberVoteHistoryExperience creationEnabled={false} />);

    expect(
      await screen.findByRole("heading", { name: "기록 회원님의 선택 기록" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "2026년 8월" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2026년 7월" })).toBeVisible();
    expect(screen.getAllByLabelText("현재 결과 A 60%, B 40%")).toHaveLength(2);
    expect(screen.getByText("A · 바로 하기")).toBeVisible();
    const resultLinks = screen.getAllByRole("link", { name: /최신 결과 보기/ });
    expect(resultLinks).toHaveLength(2);
    expect(resultLinks[0]?.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/icons/double-chevron.png"),
    );
    expect(screen.getByRole("link", { name: "투표 기록" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "내 질문" })).toHaveAttribute(
      "href",
      "/me/submissions",
    );
    const pointRail = screen.getByRole("complementary", { name: "WHICH 안내" });
    expect(await screen.findByText("120P")).toBeVisible();
    expect(pointRail).toContainElement(screen.getByRole("heading", { name: "나의 W Point" }));
    expect(screen.queryByRole("link", { name: "프로필로 돌아가기" })).not.toBeInTheDocument();
    expect(requests).toContain("/api/me?limit=20");
    expect(requests).toContain("/api/me/points?limit=5");

    fireEvent.click(screen.getByRole("button", { name: "이전 기록 더 보기" }));

    expect(await screen.findByText("휴가는 어떤 방식이 좋을까")).toBeVisible();
    expect(screen.getByLabelText("현재 결과 A 40%, B 27%, C 20%, D 13%")).toBeVisible();
    expect(screen.getByText("D · 도움 요청하기")).toBeVisible();
    await waitFor(() => expect(requests).toContain("/api/me?limit=20&cursor=cursor-1"));
    expect(screen.queryByRole("button", { name: "이전 기록 더 보기" })).not.toBeInTheDocument();
  }, 15_000);

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

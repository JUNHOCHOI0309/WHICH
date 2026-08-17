import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetGuestPreparation } from "@/features/issues/client";
import { IssueExperience } from "@/features/issues/issue-experience";
import type { PublicIssue, VoteResponse } from "@/lib/contracts";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const ISSUE_ID = "10000000-0000-4000-8000-000000000001";

const issue: PublicIssue = {
  id: ISSUE_ID,
  version: 1,
  categoryCode: "DAILY_LIFE",
  question: "평생 하나만 고른다면?",
  context: "당신의 일상에 더 가까운 쪽을 골라보세요.",
  publishedAt: "2026-08-18T00:00:00.000Z",
  choices: [
    { id: "choice-a", code: "A", label: "아침형 인간" },
    { id: "choice-b", code: "B", label: "저녁형 인간" },
  ],
  experienceModeCode: "CORE_VOTE",
  result: { visibility: "PRE_VOTE_HIDDEN", tally: null },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("IssueExperience", () => {
  beforeEach(() => {
    resetGuestPreparation();
    navigation.push.mockReset();
    vi.restoreAllMocks();
  });

  it("records one vote and reveals results only after selection", async () => {
    const voteRequests: RequestInit[] = [];
    const voteResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-1",
      voteId: "vote-1",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "A",
      result: {
        resultVersion: 1,
        acceptedA: 3,
        acceptedB: 1,
        displayedTotal: 4,
        integrityState: "NORMAL",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`)) {
          voteRequests.push(init ?? {});
          return jsonResponse(voteResult);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({
            items: [
              {
                id: "comment-a",
                choice: "A",
                author: { displayName: "아침 산책자" },
                body: "아침 시간을 온전히 쓸 수 있어서 좋아요.",
                threadState: "OPEN",
                createdAt: "2026-08-18T02:00:00.000Z",
                editedAt: null,
              },
            ],
            nextCursor: null,
          });
        }
        if (url.startsWith("/api/issues/feed?")) {
          return jsonResponse({
            items: [
              {
                id: "20000000-0000-4000-8000-000000000001",
                version: 1,
                question: "다음 질문",
                publishedAt: "2026-08-18T01:00:00.000Z",
                categoryCode: "DAILY_LIFE",
                choices: issue.choices,
              },
            ],
            nextCursor: null,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    const choice = await screen.findByRole("button", { name: "A, 아침형 인간" });
    expect(screen.queryByText("75%")).not.toBeInTheDocument();

    fireEvent.click(choice);
    fireEvent.click(choice);

    expect(await screen.findByText("당신의 선택이 반영됐어요.")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(await screen.findByText("아침 시간을 온전히 쓸 수 있어서 좋아요.")).toBeInTheDocument();
    expect(voteRequests).toHaveLength(1);

    const requestBody = JSON.parse(String(voteRequests[0]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({ issueVersion: 1, choiceId: "choice-a" });
    expect(requestBody.idempotencyKey).toEqual(expect.any(String));

    fireEvent.click(screen.getByRole("button", { name: /다음 질문 보기/ }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/issues/20000000-0000-4000-8000-000000000001"),
    );
  });

  it("explains that the first choice remains for a duplicate vote", async () => {
    const duplicateResult: VoteResponse = {
      outcome: "REJECTED_DUPLICATE",
      voteAttemptId: "attempt-2",
      voteId: "vote-1",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "A",
      result: {
        resultVersion: 1,
        acceptedA: 3,
        acceptedB: 1,
        displayedTotal: 4,
        integrityState: "NORMAL",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`)) {
          return jsonResponse(duplicateResult, 409);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "B, 저녁형 인간" }));

    expect(await screen.findByText("이미 참여한 질문이에요.")).toBeInTheDocument();
    expect(screen.getByText("처음 선택이 결과에 그대로 유지됩니다.")).toBeInTheDocument();
    expect(screen.getByText("나의 선택").closest("div")).toHaveTextContent("아침형 인간");
  });

  it("filters A/B reasons without blocking the result or next action", async () => {
    const voteResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-3",
      voteId: "vote-3",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "B",
      result: {
        resultVersion: 2,
        acceptedA: 2,
        acceptedB: 2,
        displayedTotal: 4,
        integrityState: "NORMAL",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`)) return jsonResponse(voteResult);
        if (url.includes(`/api/issues/${ISSUE_ID}/comments?side=B`)) {
          return jsonResponse({
            items: [
              {
                id: "comment-b",
                choice: "B",
                author: { displayName: "저녁 산책자" },
                body: "늦은 시간에 더 집중이 잘돼요.",
                threadState: "LOCKED",
                createdAt: "2026-08-18T03:00:00.000Z",
                editedAt: null,
              },
            ],
            nextCursor: null,
          });
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({
            items: [
              {
                id: "comment-a",
                choice: "A",
                author: { displayName: "아침 산책자" },
                body: "아침이 좋아요.",
                threadState: "OPEN",
                createdAt: "2026-08-18T02:00:00.000Z",
                editedAt: null,
              },
            ],
            nextCursor: null,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "B, 저녁형 인간" }));
    expect(await screen.findByText("아침이 좋아요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "B 선택" }));
    expect(await screen.findByText("늦은 시간에 더 집중이 잘돼요.")).toBeInTheDocument();
    expect(screen.getByText("대화 잠김")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다음 질문 보기/ })).toBeInTheDocument();
  });

  it("keeps result and next action available when Comments fail", async () => {
    const voteResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-4",
      voteId: "vote-4",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "A",
      result: {
        resultVersion: 1,
        acceptedA: 1,
        acceptedB: 0,
        displayedTotal: 1,
        integrityState: "NORMAL",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`)) return jsonResponse(voteResult);
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ code: "API_UNAVAILABLE", message: "failed" }, 502);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "A, 아침형 인간" }));

    expect(
      await screen.findByText("선택 이유를 불러오지 못했어요. 결과는 그대로 유지됩니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다음 질문 보기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "댓글만 다시 불러오기" })).toBeInTheDocument();
  });

  it("shows a recoverable state when the question cannot load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        return jsonResponse({ code: "ISSUE_NOT_AVAILABLE", message: "Issue is not open." }, 409);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(await screen.findByText("지금은 참여할 수 없는 질문이에요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

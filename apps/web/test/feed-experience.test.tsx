import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeedExperience } from "@/features/feed/feed-experience";
import { resetGuestPreparation } from "@/features/issues/client";
import type { PublicIssueFeed } from "@/lib/contracts";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const feed: PublicIssueFeed = {
  items: [
    {
      id: "10000000-0000-4000-8000-000000000003",
      version: 1,
      question: "여행은 미리 계획하는 편인가요?",
      publishedAt: "2026-08-17T02:00:00.000Z",
      categoryCode: "TRAVEL",
      mediaMode: "TEXT_ONLY",
      choices: [
        { id: "choice-a", code: "A", label: "미리 계획한다", media: null },
        { id: "choice-b", code: "B", label: "가서 정한다", media: null },
      ],
      recommendation: {
        requestId: "20000000-0000-4000-8000-000000000001",
        score: 0,
        reasonCodes: ["RECENT_FALLBACK"],
        matchedCardCodes: [],
      },
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      version: 1,
      question: "휴일에는 밖으로 나가는 편인가요?",
      publishedAt: "2026-08-17T01:00:00.000Z",
      categoryCode: "DAILY_LIFE",
      mediaMode: "TEXT_ONLY",
      choices: [
        { id: "choice-c", code: "A", label: "일단 나간다", media: null },
        { id: "choice-d", code: "B", label: "집에서 쉰다", media: null },
      ],
      recommendation: {
        requestId: "20000000-0000-4000-8000-000000000001",
        score: 0,
        reasonCodes: ["RECENT_FALLBACK"],
        matchedCardCodes: [],
      },
    },
  ],
  nextCursor: null,
  ranking: {
    requestId: "20000000-0000-4000-8000-000000000001",
    version: "interest_content_v2_refresh",
    mode: "RECENCY",
    reasonCode: "PROFILE_NOT_READY",
    profileVersion: null,
  },
};

const personalizedFeed: PublicIssueFeed = {
  ...feed,
  items: feed.items.map((item) => ({
    ...item,
    recommendation: {
      ...item.recommendation,
      reasonCodes: ["INTEREST_MATCH"],
      matchedCardCodes: ["TRAVEL"],
      score: 1000,
    },
  })),
  ranking: {
    ...feed.ranking,
    mode: "PERSONALIZED",
    reasonCode: "INTEREST_PROFILE_MATCH",
    profileVersion: 1,
  },
};

describe("FeedExperience", () => {
  beforeEach(() => {
    resetGuestPreparation();
    sessionStorage.clear();
    navigation.push.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
      writable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(max-width: 767px)" ? window.innerWidth <= 767 : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("refreshes the mobile feed after a valid pull gesture without clearing the current cards", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390, writable: true });
    let feedAttempts = 0;
    const refreshedFeed = {
      ...feed,
      items: [{ ...feed.items[1]!, question: "새로 불러온 모바일 질문" }, feed.items[0]!],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) {
          feedAttempts += 1;
          return jsonResponse(feedAttempts === 1 ? feed : refreshedFeed);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);
    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();

    fireEvent.touchStart(window, { touches: [{ clientX: 100, clientY: 10 }] });
    fireEvent.touchMove(window, {
      touches: [{ clientX: 102, clientY: 170 }],
      cancelable: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent("놓아서 새로고침");
    expect(screen.getByText(feed.items[0]!.question)).toBeInTheDocument();
    fireEvent.touchEnd(window);

    expect(await screen.findByText("새로 불러온 모바일 질문")).toBeInTheDocument();
    await waitFor(() => expect(feedAttempts).toBe(2));
  });

  it("ignores short and horizontal mobile gestures", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390, writable: true });
    let feedAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) {
          feedAttempts += 1;
          return jsonResponse(feed);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);
    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();

    fireEvent.touchStart(window, { touches: [{ clientX: 100, clientY: 10 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 101, clientY: 70 }] });
    fireEvent.touchEnd(window);
    fireEvent.touchStart(window, { touches: [{ clientX: 20, clientY: 20 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 160, clientY: 70 }] });
    fireEvent.touchEnd(window);

    expect(feedAttempts).toBe(1);
  });

  it("keeps the current mobile feed when pull-to-refresh fails", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390, writable: true });
    let feedAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) {
          feedAttempts += 1;
          return feedAttempts === 1
            ? jsonResponse(feed)
            : jsonResponse({ code: "API_UNAVAILABLE", message: "down" }, 502);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);
    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    fireEvent.touchStart(window, { touches: [{ clientX: 100, clientY: 10 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 100, clientY: 170 }] });
    fireEvent.touchEnd(window);

    expect(await screen.findByText("새로고침하지 못했어요")).toBeInTheDocument();
    expect(screen.getByText(feed.items[0]!.question)).toBeInTheDocument();
  });

  it("shows a TOP control after scrolling and moves the page to the top", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);
    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    const topButton = screen.getByLabelText("페이지 맨 위로 이동", { selector: "button" });
    expect(topButton).toHaveAttribute("aria-hidden", "true");

    window.scrollY = 800;
    fireEvent.scroll(window);
    expect(topButton).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(topButton);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("excludes the previous first question after a browser refresh", async () => {
    sessionStorage.setItem("which:feed:last-first-issue", feed.items[0]!.id);
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    expect(
      requests.some((url) =>
        url.includes(`excludeIssueId=${encodeURIComponent(feed.items[0]!.id)}`),
      ),
    ).toBe(true);
  });

  it("opens the Question composer from the rail for an active Member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-1", displayName: "질문러", status: "ACTIVE" },
          });
        }
        if (url === "/api/interests/cards") {
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            minSelections: 3,
            maxSelections: 8,
            cards: [
              {
                code: "DAILY_LIFE",
                label: "생활",
                categoryCodes: ["LIFE"],
                topicCodes: ["DAILY"],
              },
            ],
          });
        }
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience creationEnabled />);

    const desktopQuestionButton = await screen.findByRole("button", { name: "Question" });
    const mobileQuestionButton = screen.getByRole("button", { name: "질문" });
    expect(mobileQuestionButton).toHaveTextContent("?");
    fireEvent.click(desktopQuestionButton);
    expect(await screen.findByRole("dialog", { name: "Question" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "사람들에게 어떤 선택을 물어볼까요?" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Question" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Question" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("does not show the question creation CTA to a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience creationEnabled />);

    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Question" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "질문" })).not.toBeInTheDocument();
  });

  it("keeps only the mobile question entry when inline submissions are disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEATURE_CREATOR_SUBMISSIONS_ENABLED", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-1", displayName: "질문러", status: "ACTIVE" },
          });
        }
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience creationEnabled={false} />);

    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Question" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "질문" })).toBeInTheDocument();
  });

  it("prepares the Guest before showing result-free Issue cards", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText("여행은 미리 계획하는 편인가요?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A 선택, 미리 계획한다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B 선택, 가서 정한다" })).toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(requests).toContain("/api/guest-subjects");
    expect(screen.getAllByRole("link", { name: /상세·댓글 보기/ })[0]?.getAttribute("href")).toBe(
      "/issues/10000000-0000-4000-8000-000000000003",
    );
  });

  it("replaces the static principle with result-free participation links", async () => {
    const participationFeed: PublicIssueFeed = {
      ...feed,
      rightRail: {
        version: "participation_v1",
        items: [
          {
            issueId: feed.items[0]!.id,
            question: feed.items[0]!.question,
            categoryCode: feed.items[0]!.categoryCode,
            participationCount: 18,
            reasonCode: "RECENT_PARTICIPATION",
          },
          {
            issueId: feed.items[1]!.id,
            question: feed.items[1]!.question,
            categoryCode: feed.items[1]!.categoryCode,
            participationCount: 0,
            reasonCode: "RECENT_FALLBACK",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(participationFeed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText("지금 많이 참여하는 질문")).toBeInTheDocument();
    expect(screen.getByText(/18명 참여/)).toBeInTheDocument();
    expect(screen.getByText(/새 질문/)).toBeInTheDocument();
    expect(screen.queryByText("WHICH PRINCIPLE")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === `/issues/${feed.items[0]!.id}`),
    ).toHaveLength(3);
  });

  it("shows an empty completion state and can retry a failed load", async () => {
    let feedAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        feedAttempts += 1;
        if (feedAttempts === 1) {
          return jsonResponse({ code: "API_UNAVAILABLE", message: "down" }, 502);
        }
        return jsonResponse({ items: [], nextCursor: null, ranking: feed.ranking });
      }),
    );

    render(<FeedExperience />);

    fireEvent.click(await screen.findByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("지금 참여할 수 있는 질문을 모두 봤어요.")).toBeInTheDocument();
    await waitFor(() => expect(feedAttempts).toBe(2));
  });

  it("labels personalized results and records feed-view and issue-open attribution", async () => {
    const analyticsEvents: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(personalizedFeed);
        if (url === "/api/analytics/events") {
          analyticsEvents.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return jsonResponse({ accepted: true, duplicate: false });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText("관심사 기반")).toBeInTheDocument();
    await waitFor(() =>
      expect(analyticsEvents.map((event) => event.eventType)).toContain("PERSONALIZED_FEED_VIEW"),
    );
    fireEvent.click(screen.getAllByRole("link", { name: /상세·댓글 보기/ })[0]!);
    await waitFor(() =>
      expect(analyticsEvents.map((event) => event.eventType)).toContain("PERSONALIZED_ISSUE_OPEN"),
    );
    expect(
      analyticsEvents.every(
        (event) => event.recommendationRequestId === personalizedFeed.ranking.requestId,
      ),
    ).toBe(true);
  });

  it("submits one inline vote and reveals a single balance result only after success", async () => {
    const vote = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-1",
      voteId: "vote-1",
      issueId: feed.items[0]!.id,
      issueVersion: 1,
      choice: "A",
      result: {
        resultVersion: 1,
        acceptedA: 6,
        acceptedB: 4,
        displayedTotal: 10,
        integrityState: "NORMAL",
      },
    };
    const voteRequests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        if (url.endsWith("/votes")) {
          voteRequests.push(init ?? {});
          return jsonResponse(vote);
        }
        if (url.endsWith("/comment-highlights")) {
          return jsonResponse({
            A: [
              {
                id: "comment-a",
                choice: "A",
                author: { displayName: "계획파" },
                body: "준비하면 여행이 더 편해요.",
                visibility: "VISIBLE",
                threadState: "OPEN",
                createdAt: "2026-08-17T03:00:00.000Z",
                editedAt: null,
                reactions: { helpfulCount: 4, viewerReacted: false },
                reports: { viewerReported: false, canReport: true },
              },
            ],
            B: [
              {
                id: "comment-b",
                choice: "B",
                author: { displayName: "즉흥파" },
                body: "현지에서 정하는 재미가 있어요.",
                visibility: "VISIBLE",
                threadState: "OPEN",
                createdAt: "2026-08-17T02:00:00.000Z",
                editedAt: null,
                reactions: { helpfulCount: 3, viewerReacted: false },
                reports: { viewerReported: false, canReport: true },
              },
            ],
          });
        }
        if (url === "/api/analytics/events") {
          return jsonResponse({ accepted: true, duplicate: false });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText(feed.items[0]!.question)).toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A 선택, 미리 계획한다" }));

    expect(await screen.findByText("A 선택이 반영됐어요.")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(await screen.findByText("준비하면 여행이 더 편해요.")).toBeInTheDocument();
    expect(screen.getByText("현지에서 정하는 재미가 있어요.")).toBeInTheDocument();
    expect(voteRequests).toHaveLength(1);
    expect(JSON.parse(String(voteRequests[0]?.body))).toMatchObject({
      issueVersion: 1,
      choiceId: "choice-a",
    });
  });
});

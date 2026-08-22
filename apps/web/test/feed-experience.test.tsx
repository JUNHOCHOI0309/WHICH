import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeedExperience } from "@/features/feed/feed-experience";
import { resetGuestPreparation } from "@/features/issues/client";
import type { PublicIssueFeed } from "@/lib/contracts";

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
      choices: [
        { id: "choice-a", code: "A", label: "미리 계획한다" },
        { id: "choice-b", code: "B", label: "가서 정한다" },
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
      choices: [
        { id: "choice-c", code: "A", label: "일단 나간다" },
        { id: "choice-d", code: "B", label: "집에서 쉰다" },
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
    version: "interest_content_v1",
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
    vi.restoreAllMocks();
  });

  it("prepares the Guest before showing result-free Issue cards", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.startsWith("/api/issues/feed?")) return jsonResponse(feed);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<FeedExperience />);

    expect(await screen.findByText("여행은 미리 계획하는 편인가요?")).toBeInTheDocument();
    expect(screen.getByText("A · 미리 계획한다")).toBeInTheDocument();
    expect(screen.getByText("B · 가서 정한다")).toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(requests[0]).toBe("/api/guest-subjects");
    expect(
      screen.getAllByRole("link", { name: /이 질문에 참여하기/ })[0]?.getAttribute("href"),
    ).toBe("/issues/10000000-0000-4000-8000-000000000003");
  });

  it("shows an empty completion state and can retry a failed load", async () => {
    let feedAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
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
    expect(await screen.findByText("지금 참여할 질문을 모두 골랐어요.")).toBeInTheDocument();
    await waitFor(() => expect(feedAttempts).toBe(2));
  });

  it("labels personalized results and records feed-view and issue-open attribution", async () => {
    const analyticsEvents: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
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

    expect(await screen.findByText("관심사 기반 추천")).toBeInTheDocument();
    await waitFor(() =>
      expect(analyticsEvents.map((event) => event.eventType)).toContain("PERSONALIZED_FEED_VIEW"),
    );
    fireEvent.click(screen.getAllByRole("link", { name: /이 질문에 참여하기/ })[0]!);
    await waitFor(() =>
      expect(analyticsEvents.map((event) => event.eventType)).toContain("PERSONALIZED_ISSUE_OPEN"),
    );
    expect(
      analyticsEvents.every(
        (event) => event.recommendationRequestId === personalizedFeed.ranking.requestId,
      ),
    ).toBe(true);
  });
});

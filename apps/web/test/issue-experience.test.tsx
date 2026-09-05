import {
  act,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/feedback/toast-provider";
import { resetGuestPreparation } from "@/features/issues/client";
import { IssueExperience } from "@/features/issues/issue-experience";
import type { PublicIssue, VoteResponse } from "@/lib/contracts";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const ISSUE_ID = "10000000-0000-4000-8000-000000000001";

function render(ui: ReactElement) {
  return testingRender(<ToastProvider>{ui}</ToastProvider>);
}

const issue: PublicIssue = {
  id: ISSUE_ID,
  version: 1,
  categoryCode: "DAILY_LIFE",
  question: "평생 하나만 고른다면?",
  context: "당신의 일상에 더 가까운 쪽을 골라보세요.",
  publishedAt: "2026-08-18T00:00:00.000Z",
  mediaMode: "TEXT_ONLY",
  choices: [
    { id: "choice-a", code: "A", label: "아침형 인간", media: null },
    { id: "choice-b", code: "B", label: "저녁형 인간", media: null },
  ],
  author: null,
  engagement: {
    recommendationCount: 4,
    commentCount: 7,
    viewerRecommended: false,
    viewerReported: false,
  },
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
    sessionStorage.clear();
    navigation.push.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders server-provided question content immediately but blocks voting while restoring", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // Keep guest preparation pending so the restoring state can be asserted deterministically.
          }),
      ),
    );

    render(<IssueExperience issueId={ISSUE_ID} initialIssue={issue} />);

    expect(screen.getByRole("heading", { name: issue.question })).toBeInTheDocument();
    expect(screen.getByText(issue.context!)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A 선택, 아침형 인간" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "B 선택, 저녁형 인간" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("참여 기록을 확인하고 있어요");
  });

  it("hydrates server discovery content with viewer-eligible public media before voting", async () => {
    const interactiveIssue: PublicIssue = {
      ...issue,
      mediaMode: "OPTION_IMAGES",
      choices: issue.choices.map((choice) => ({
        ...choice,
        media: {
          url: `https://issue-media.example/${choice.code}.webp`,
          altText: `${choice.label} 이미지`,
          cropMode: "CONTAIN" as const,
          width: 1200,
          height: 800,
        },
      })),
    };
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
      if (url === `/api/issues/${ISSUE_ID}`) return jsonResponse(interactiveIssue);
      if (url.includes("vote-status")) return jsonResponse({ code: "VOTE_NOT_FOUND" }, 404);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);

    render(<IssueExperience issueId={ISSUE_ID} initialIssue={issue} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "A 선택, 아침형 인간" })).toBeEnabled();
    });
    expect(request).toHaveBeenCalledWith(
      `/api/issues/${ISSUE_ID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByAltText("아침형 인간 이미지")).toHaveAttribute(
      "src",
      "https://issue-media.example/A.webp",
    );
    expect(screen.getByAltText("저녁형 인간 이미지")).toHaveAttribute(
      "src",
      "https://issue-media.example/B.webp",
    );
  });

  it("links an authored Issue to its public Creator profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) {
          return jsonResponse({
            ...issue,
            author: {
              displayName: "테크 질문가",
              handle: "tech_creator",
              avatar: { kind: "INITIALS", initials: "테질" },
            },
          });
        }
        if (url.includes("vote-status")) return jsonResponse({ code: "VOTE_NOT_FOUND" }, 404);
        return jsonResponse({});
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(await screen.findByRole("link", { name: /테크 질문가/ })).toHaveAttribute(
      "href",
      "/user/tech_creator",
    );
  });

  it("recommends a question from the detail screen and keeps the server count", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
      if (url === `/api/issues/${ISSUE_ID}`) return jsonResponse(issue);
      if (url.includes("vote-status")) return jsonResponse({ code: "VOTE_NOT_FOUND" }, 404);
      if (url === `/api/issues/${ISSUE_ID}/recommendation` && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ active: true });
        return jsonResponse({ recommendation: { active: true, count: 5 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);

    render(<IssueExperience issueId={ISSUE_ID} />);

    const recommendButton = await screen.findByRole("button", { name: "추천 4개" });
    fireEvent.click(recommendButton);

    expect(await screen.findByRole("button", { name: "추천 5개" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reports a question from the detail screen", async () => {
    const reportRequests: RequestInit[] = [];
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
      if (url === `/api/issues/${ISSUE_ID}`) return jsonResponse(issue);
      if (url.includes("vote-status")) return jsonResponse({ code: "VOTE_NOT_FOUND" }, 404);
      if (url === "/api/reports" && init?.method === "POST") {
        reportRequests.push(init);
        return jsonResponse({
          report: { id: "report-1", accepted: true, counted: true },
          case: {
            id: "case-1",
            status: "OPEN",
            priority: "NORMAL",
            automationRecommendation: "NONE",
          },
          signals: {
            reporterCount: 1,
            weightedScore: 1,
            reports15m: 1,
            reports24h: 1,
            clusterClassification: "BASELINE",
            shadowOnly: true,
          },
          target: { hidden: false },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);

    render(<IssueExperience issueId={ISSUE_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: "질문 신고" }));
    expect(screen.getByRole("dialog", { name: "이 질문을 신고할까요?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "신고 접수" }));

    expect(await screen.findByRole("button", { name: "신고한 질문" })).toBeDisabled();
    expect(reportRequests).toHaveLength(1);
    expect(JSON.parse(String(reportRequests[0]?.body))).toEqual({
      targetType: "ISSUE",
      targetId: ISSUE_ID,
      reasonCode: "SPAM",
    });
  });

  it("records an impression only after 50% visibility lasts for 500ms", async () => {
    const observerCallbacks = new Map<Element, IntersectionObserverCallback>();
    let resolveObserverReady: (() => void) | undefined;
    const observerReady = new Promise<void>((resolve) => {
      resolveObserverReady = resolve;
    });
    const analyticsEvents: string[] = [];

    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0.5];
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observerCallbacks.set(target, this.callback);
        if (target.tagName === "ARTICLE") resolveObserverReady?.();
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/analytics/events") {
          const body = JSON.parse(String(init?.body)) as { eventType: string };
          analyticsEvents.push(body.eventType);
          return jsonResponse({ accepted: true, duplicate: false });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    await screen.findByRole("button", { name: "A 선택, 아침형 인간" });
    await observerReady;
    const article = screen.getByRole("article");
    const callback = observerCallbacks.get(article);
    expect(callback).toBeDefined();
    const scheduledImpressions: Array<() => void> = [];
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler, delay) => {
      if (delay === 500 && typeof handler === "function") scheduledImpressions.push(handler);
      return 4242 as unknown as ReturnType<typeof window.setTimeout>;
    });
    try {
      act(() => {
        callback?.(
          [{ target: article, intersectionRatio: 0.49 } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      expect(scheduledImpressions).toHaveLength(0);
      expect(analyticsEvents).toHaveLength(0);

      act(() => {
        callback?.(
          [{ target: article, intersectionRatio: 0.5 } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
      expect(scheduledImpressions).toHaveLength(1);
      await act(async () => {
        scheduledImpressions[0]?.();
        await Promise.resolve();
      });
      expect(analyticsEvents).toEqual(["ISSUE_VIEWABLE_IMPRESSION"]);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("opens one random eligible Issue after the pre-vote lower area is visible and the screen is dragged upward", async () => {
    const observerCallbacks = new Map<Element, IntersectionObserverCallback>();
    let feedRequests = 0;
    const analyticsEvents: string[] = [];
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.75);

    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.5];
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observerCallbacks.set(target, this.callback);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.includes("vote-status")) return jsonResponse({ code: "VOTE_NOT_FOUND" }, 404);
        if (url.startsWith("/api/issues/feed?")) {
          feedRequests += 1;
          expect(url).toContain("limit=6");
          expect(url).toContain(`excludeIssueId=${ISSUE_ID}`);
          return jsonResponse({
            items: [
              {
                ...issue,
                id: "20000000-0000-4000-8000-000000000001",
                recommendation: {
                  requestId: "30000000-0000-4000-8000-000000000001",
                  score: 0,
                  reasonCodes: ["RECENT_FALLBACK"],
                  matchedCardCodes: [],
                },
              },
              {
                ...issue,
                id: "20000000-0000-4000-8000-000000000002",
                recommendation: {
                  requestId: "30000000-0000-4000-8000-000000000002",
                  score: 0,
                  reasonCodes: ["EXPLORATION"],
                  matchedCardCodes: [],
                },
              },
            ],
            nextCursor: null,
            ranking: {
              requestId: "30000000-0000-4000-8000-000000000003",
              version: "interest_content_v2_refresh",
              mode: "RECENCY",
              reasonCode: "PROFILE_NOT_READY",
              profileVersion: null,
            },
          });
        }
        if (url === "/api/analytics/events") {
          const body = JSON.parse(String(init?.body)) as { eventType: string };
          analyticsEvents.push(body.eventType);
          return jsonResponse({ accepted: true });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    const lowerArea = await screen.findByTestId("pre-vote-wheel-next");
    await waitFor(() => expect(observerCallbacks.get(lowerArea)).toBeDefined());
    const callback = observerCallbacks.get(lowerArea);

    act(() => {
      callback?.(
        [
          {
            target: lowerArea,
            isIntersecting: true,
            intersectionRatio: 0.49,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    fireEvent.wheel(window, { deltaY: 120 });
    expect(feedRequests).toBe(0);

    act(() => {
      callback?.(
        [
          {
            target: lowerArea,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    fireEvent.wheel(window, { deltaY: -120 });
    expect(feedRequests).toBe(0);

    fireEvent.touchStart(window, {
      touches: [{ clientX: 160, clientY: 560 }],
    });
    fireEvent.touchEnd(window, {
      changedTouches: [{ clientX: 164, clientY: 450 }],
    });

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/issues/20000000-0000-4000-8000-000000000002"),
    );
    expect(feedRequests).toBe(1);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(analyticsEvents).toContain("NEXT_ISSUE_OPEN");
    randomSpy.mockRestore();
  });

  it("cancels an in-flight wheel transition as soon as a choice is selected", async () => {
    const observerCallbacks = new Map<Element, IntersectionObserverCallback>();
    let feedSignal: AbortSignal | undefined;

    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.5];
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observerCallbacks.set(target, this.callback);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") {
          return Promise.resolve(jsonResponse({ status: "ready" }));
        }
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return Promise.resolve(jsonResponse(issue));
        if (url.includes("vote-status")) {
          return Promise.resolve(jsonResponse({ code: "VOTE_NOT_FOUND" }, 404));
        }
        if (url.startsWith("/api/issues/feed?")) {
          feedSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            feedSignal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        }
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`)) {
          return new Promise<Response>(() => undefined);
        }
        if (url === "/api/analytics/events") {
          return Promise.resolve(jsonResponse({ accepted: true }));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    const lowerArea = await screen.findByTestId("pre-vote-wheel-next");
    const choice = screen.getByRole("button", { name: "A 선택, 아침형 인간" });
    await waitFor(() => expect(observerCallbacks.get(lowerArea)).toBeDefined());
    act(() => {
      observerCallbacks.get(lowerArea)?.(
        [
          {
            target: lowerArea,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    fireEvent.wheel(window, { deltaY: 120 });
    await waitFor(() => expect(feedSignal).toBeDefined());

    fireEvent.click(choice);

    expect(screen.queryByTestId("pre-vote-wheel-next")).not.toBeInTheDocument();
    expect(feedSignal?.aborted).toBe(true);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("records one vote and reveals results only after selection", async () => {
    const voteRequests: RequestInit[] = [];
    const shareRequests: RequestInit[] = [];
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, share: undefined });
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
        if (url.endsWith(`/api/issues/${ISSUE_ID}/share-cards`)) {
          shareRequests.push(init ?? {});
          return jsonResponse(
            {
              shareCard: { id: "share-card-1" },
              url: `https://whichone.site/s/share-card-1`,
            },
            201,
          );
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
                recommendation: {
                  requestId: "30000000-0000-4000-8000-000000000001",
                  score: 0,
                  reasonCodes: ["RECENT_FALLBACK"],
                  matchedCardCodes: [],
                },
              },
            ],
            nextCursor: null,
            ranking: {
              requestId: "30000000-0000-4000-8000-000000000001",
              version: "interest_content_v2_refresh",
              mode: "RECENCY",
              reasonCode: "PROFILE_NOT_READY",
              profileVersion: null,
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    const choice = await screen.findByRole("button", { name: "A 선택, 아침형 인간" });
    expect(screen.getByTestId("pre-vote-wheel-next")).toBeInTheDocument();
    expect(screen.queryByText("75%")).not.toBeInTheDocument();

    fireEvent.click(choice);
    fireEvent.click(choice);
    expect(screen.queryByTestId("pre-vote-wheel-next")).not.toBeInTheDocument();

    expect(await screen.findByText("당신의 선택이 반영됐어요.")).toBeInTheDocument();
    expect(screen.getByText("VOTE RECORD")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(await screen.findByText("아침 시간을 온전히 쓸 수 있어서 좋아요.")).toBeInTheDocument();
    expect(voteRequests).toHaveLength(1);
    expect(screen.queryByText("RESULT SHARE")).not.toBeInTheDocument();
    expect(screen.queryByText("YOUR INTERESTS")).not.toBeInTheDocument();
    expect(screen.queryByText("MEMBER LINK")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X 공유" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "공유하기" }));
    expect(screen.getByText("RESULT SHARE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "접기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공유하기" }));
    expect(screen.queryByText("RESULT SHARE")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공유하기" }));
    expect(screen.getByRole("button", { name: "결과 공유하기" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "내가 고른 A도 함께 공개" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "결과 공유하기" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://whichone.site/s/share-card-1"),
    );
    expect(JSON.parse(String(shareRequests[0]?.body))).toMatchObject({ channel: "SYSTEM" });
    expect(JSON.parse(String(shareRequests[0]?.body))).not.toHaveProperty("sharedChoiceCode");
    expect(screen.getByText("공유 링크를 복사했어요.")).toBeInTheDocument();

    const requestBody = JSON.parse(String(voteRequests[0]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({ issueVersion: 1, choiceId: "choice-a" });
    expect(requestBody.idempotencyKey).toEqual(expect.any(String));

    const nextPreview = await screen.findByRole("button", {
      name: "다음 질문으로 이동: 다음 질문",
    });
    expect(nextPreview).toHaveTextContent("NEXT ISSUE");
    expect(nextPreview).toHaveTextContent("아침형 인간");
    expect(nextPreview).toHaveTextContent("저녁형 인간");
    expect(within(nextPreview).getByText("다음 질문")).toHaveAttribute("title", "다음 질문");
    expect(within(nextPreview).getByText("아침형 인간")).toHaveAttribute("title", "아침형 인간");
    expect(within(nextPreview).getByText("저녁형 인간")).toHaveAttribute("title", "저녁형 인간");
  });

  it("prefetches the next Issue but opens it and records analytics only after preview click", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-auto-next",
      voteId: "vote-auto-next",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));

    let feedRequests = 0;
    const analyticsEvents: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null, totalCount: 0 });
        }
        if (url.startsWith("/api/issues/feed?")) {
          feedRequests += 1;
          return jsonResponse({
            items: [
              {
                ...issue,
                id: "20000000-0000-4000-8000-000000000001",
                recommendation: {
                  requestId: "30000000-0000-4000-8000-000000000001",
                  score: 0,
                  reasonCodes: ["RECENT_FALLBACK"],
                  matchedCardCodes: [],
                },
              },
            ],
            nextCursor: null,
            ranking: {
              requestId: "30000000-0000-4000-8000-000000000001",
              version: "interest_content_v2_refresh",
              mode: "RECENCY",
              reasonCode: "PROFILE_NOT_READY",
              profileVersion: null,
            },
          });
        }
        if (url === "/api/analytics/events") {
          const body = JSON.parse(String(init?.body)) as { eventType: string };
          analyticsEvents.push(body.eventType);
          return jsonResponse({ accepted: true });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    const nextButton = await screen.findByRole("button", {
      name: `다음 질문으로 이동: ${issue.question}`,
    });
    expect(screen.getByTestId("next-issue-preview-dock")).toHaveAttribute(
      "data-placement",
      "bottom-right",
    );
    expect(feedRequests).toBe(1);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(analyticsEvents).not.toContain("NEXT_ISSUE_OPEN");
    expect(screen.getByRole("button", { name: "다음 질문 미리보기 닫기" })).toBeInTheDocument();

    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/issues/20000000-0000-4000-8000-000000000001"),
    );
    expect(feedRequests).toBe(1);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(analyticsEvents).toContain("NEXT_ISSUE_OPEN");
  });

  it("shows a completion message when there is no next eligible Issue", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-next-empty",
      voteId: "vote-next-empty",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null, totalCount: 0 });
        }
        if (url.startsWith("/api/issues/feed?")) {
          return jsonResponse({
            items: [],
            nextCursor: null,
            ranking: {
              requestId: "30000000-0000-4000-8000-000000000002",
              version: "interest_content_v2_refresh",
              mode: "RECENCY",
              reasonCode: "PROFILE_NOT_READY",
              profileVersion: null,
            },
          });
        }
        if (url === "/api/analytics/events") return jsonResponse({ accepted: true });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(
      await screen.findByText("지금 참여할 수 있는 질문을 모두 골랐어요."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("next-issue-preview-dock")).toHaveAttribute(
      "data-placement",
      "bottom-right",
    );
    fireEvent.click(screen.getByRole("button", { name: "다음 질문 미리보기 닫기" }));
    expect(screen.queryByTestId("next-issue-preview-dock")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /다음 질문으로 이동/ })).not.toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("restores the server Vote after login instead of showing the voting screen again", async () => {
    const restoredResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-restored",
      voteId: "vote-restored",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "B",
      result: {
        resultVersion: 4,
        acceptedA: 4,
        acceptedB: 6,
        displayedTotal: 10,
        integrityState: "NORMAL",
      },
    };
    const votePosts: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/vote-status`)) {
          return jsonResponse(restoredResult);
        }
        if (url.endsWith(`/api/issues/${ISSUE_ID}/votes`) && init?.method === "POST") {
          votePosts.push(init);
          return jsonResponse(restoredResult);
        }
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(await screen.findByText("당신의 선택이 반영됐어요.")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "A 선택, 아침형 인간" })).not.toBeInTheDocument();
    expect(votePosts).toHaveLength(0);
    expect(JSON.parse(sessionStorage.getItem(`which:vote-result:${ISSUE_ID}`) ?? "null")).toEqual(
      restoredResult,
    );
  });

  it("revalidates a saved Vote and renders the current server aggregate", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-stale",
      voteId: "vote-stale",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "A",
      result: {
        resultVersion: 2,
        acceptedA: 1,
        acceptedB: 1,
        displayedTotal: 2,
        integrityState: "NORMAL",
      },
    };
    const currentResult: VoteResponse = {
      ...savedResult,
      result: {
        resultVersion: 3,
        acceptedA: 2,
        acceptedB: 1,
        displayedTotal: 3,
        integrityState: "NORMAL",
      },
    };
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url.endsWith(`/api/issues/${ISSUE_ID}/vote-status`)) {
          return jsonResponse(currentResult);
        }
        if (url === "/api/member-session") return jsonResponse({ code: "SESSION_INVALID" }, 401);
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null, totalCount: 0 });
        }
        if (url.startsWith("/api/issues/feed?")) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(await screen.findByText("67%")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.getByText("3명 참여")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(`which:vote-result:${ISSUE_ID}`) ?? "null")).toEqual(
      currentResult,
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
    fireEvent.click(await screen.findByRole("button", { name: "B 선택, 저녁형 인간" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "B 선택, 저녁형 인간" }));
    expect(await screen.findByText("아침이 좋아요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "B 선택" }));
    expect(await screen.findByText("늦은 시간에 더 집중이 잘돼요.")).toBeInTheDocument();
    expect(screen.getByText("대화 잠김")).toBeInTheDocument();
    expect(screen.getByText("NEXT ISSUE")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "A 선택, 아침형 인간" }));

    expect(
      await screen.findByText("선택 이유를 불러오지 못했어요. 결과는 그대로 유지됩니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("NEXT ISSUE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "댓글만 다시 불러오기" })).toBeInTheDocument();
  });

  it("keeps a Guest draft and sends the user to login only when publishing", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-draft",
      voteId: "vote-draft",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({ code: "SESSION_INVALID", message: "login" }, 401);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} kakaoLoginEnabled naverLoginEnabled />);
    const editor = await screen.findByRole("textbox", { name: "내 선택 이유" });
    fireEvent.change(editor, { target: { value: "로그인 뒤에도 남을 초안" } });
    fireEvent.click(await screen.findByRole("button", { name: "로그인하고 작성" }));

    expect(sessionStorage.getItem(`which:comment-draft:${ISSUE_ID}`)).toBe(
      "로그인 뒤에도 남을 초안",
    );
    expect(screen.getByRole("link", { name: "Google로 로그인" })).toHaveAttribute(
      "href",
      `/api/auth/google/start?returnTo=${encodeURIComponent(`/issues/${ISSUE_ID}#comment-compose`)}`,
    );
    expect(screen.getByRole("link", { name: "X로 로그인" })).toHaveAttribute(
      "href",
      `/api/auth/x/start?returnTo=${encodeURIComponent(`/issues/${ISSUE_ID}#comment-compose`)}`,
    );
    expect(screen.getByRole("link", { name: "네이버로 로그인" })).toHaveAttribute(
      "href",
      `/api/auth/naver/start?returnTo=${encodeURIComponent(`/issues/${ISSUE_ID}#comment-compose`)}`,
    );
    expect(screen.getByRole("link", { name: "카카오로 로그인" })).toHaveAttribute(
      "href",
      `/api/auth/kakao/start?returnTo=${encodeURIComponent(`/issues/${ISSUE_ID}#comment-compose`)}`,
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps Member promotion out of the result flow and hides unreviewed login choices", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-naver-disabled",
      voteId: "vote-naver-disabled",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({ code: "SESSION_INVALID", message: "login" }, 401);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(screen.queryByText("MEMBER LINK")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /로그인 또는 빠른 회원가입/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(await screen.findByRole("textbox", { name: "내 선택 이유" }), {
      target: { value: "숨김 확인" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인하고 작성" }));
    expect(screen.queryByRole("link", { name: "네이버로 로그인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "카카오로 로그인" })).not.toBeInTheDocument();
  });

  it("publishes a Member draft with an idempotency key and prepends the Comment", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-member-comment",
      voteId: "vote-member-comment",
      issueId: ISSUE_ID,
      issueVersion: 1,
      choice: "B",
      result: {
        resultVersion: 1,
        acceptedA: 0,
        acceptedB: 1,
        displayedTotal: 1,
        integrityState: "NORMAL",
      },
    };
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));
    const requests: RequestInit[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-1", displayName: "회원", status: "ACTIVE" },
            expiresAt: "2026-08-19T00:00:00.000Z",
          });
        }
        if (url === `/api/issues/${ISSUE_ID}/comments` && init?.method === "POST") {
          requests.push(init);
          return jsonResponse(
            {
              comment: {
                id: "new-comment",
                choice: "B",
                author: { displayName: "회원" },
                body: "저녁에 집중이 잘돼요.",
                threadState: "OPEN",
                createdAt: "2026-08-18T10:00:00.000Z",
                editedAt: null,
              },
            },
            201,
          );
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    const editor = await screen.findByRole("textbox", { name: "내 선택 이유" });
    fireEvent.change(editor, { target: { value: "저녁에 집중이 잘돼요." } });
    fireEvent.click(await screen.findByRole("button", { name: "작성" }));

    expect(await screen.findByText("저녁에 집중이 잘돼요.")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(new Headers(requests[0]?.headers).get("idempotency-key")).toEqual(expect.any(String));
    expect(sessionStorage.getItem(`which:comment-draft:${ISSUE_ID}`)).toBeNull();
  });

  it("renders deeply nested replies and lets a Member reply at any depth", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-nested-reply",
      voteId: "vote-nested-reply",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));
    const replyRequests: Array<{ parentCommentId?: string; body: string }> = [];
    const commentBase = {
      visibility: "VISIBLE" as const,
      threadState: "OPEN" as const,
      editedAt: null,
      reactions: { helpfulCount: 0, dislikeCount: 0, viewerReaction: null },
      reports: { viewerReported: false, canReport: true },
      permissions: { canEdit: false, canDelete: false },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-nested", displayName: "회원", status: "ACTIVE" },
            expiresAt: "2026-08-29T00:00:00.000Z",
          });
        }
        if (url === `/api/issues/${ISSUE_ID}/comments` && init?.method === "POST") {
          const request = JSON.parse(String(init.body)) as {
            parentCommentId?: string;
            body: string;
          };
          replyRequests.push(request);
          return jsonResponse(
            {
              comment: {
                ...commentBase,
                id: "reply-3",
                choice: "A",
                author: { displayName: "회원" },
                body: request.body,
                createdAt: "2026-08-28T12:00:00.000Z",
                parentCommentId: request.parentCommentId ?? null,
                replies: [],
              },
            },
            201,
          );
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({
            items: [
              {
                ...commentBase,
                id: "root-comment",
                choice: "A",
                author: { displayName: "첫번째" },
                body: "최상위 댓글",
                createdAt: "2026-08-28T09:00:00.000Z",
                parentCommentId: null,
                replies: [
                  {
                    ...commentBase,
                    id: "reply-1",
                    choice: "B",
                    author: { displayName: "두번째" },
                    body: "첫 단계 답글",
                    createdAt: "2026-08-28T10:00:00.000Z",
                    parentCommentId: "root-comment",
                    replies: [
                      {
                        ...commentBase,
                        id: "reply-2",
                        choice: "A",
                        author: { displayName: "세번째" },
                        body: "두 단계 답글",
                        createdAt: "2026-08-28T11:00:00.000Z",
                        parentCommentId: "reply-1",
                        replies: [],
                      },
                    ],
                  },
                ],
              },
            ],
            nextCursor: null,
            totalCount: 3,
          });
        }
        if (url.startsWith("/api/issues/feed?")) {
          return jsonResponse({
            items: [],
            nextCursor: null,
            ranking: {
              requestId: "30000000-0000-4000-8000-000000000003",
              version: "interest_content_v2_refresh",
              mode: "RECENCY",
              reasonCode: "PROFILE_NOT_READY",
              profileVersion: null,
            },
          });
        }
        if (url === "/api/analytics/events") return jsonResponse({ accepted: true });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);

    expect(await screen.findByText("두 단계 답글")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "작성" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "답글" })).toHaveLength(3);

    fireEvent.click(screen.getAllByRole("button", { name: "답글" })[2]!);
    const editor = screen.getByRole("textbox", { name: "답글 작성" });
    expect(editor).toHaveAttribute("placeholder", "세번째님에게 답글을 남겨 보세요.");
    fireEvent.change(editor, { target: { value: "세 단계 답글입니다" } });
    fireEvent.click(within(editor.closest("form")!).getByRole("button", { name: "작성" }));

    await waitFor(() =>
      expect(replyRequests).toEqual([{ parentCommentId: "reply-2", body: "세 단계 답글입니다" }]),
    );
    expect(await screen.findByText("세 단계 답글입니다")).toBeInTheDocument();
  });

  it("lets a Member edit and delete their own Comment", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-own-comment",
      voteId: "vote-own-comment",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));
    const mutationMethods: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-owner", displayName: "작성자", status: "ACTIVE" },
            expiresAt: "2026-08-25T00:00:00.000Z",
          });
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({
            items: [
              {
                id: "own-comment",
                choice: "A",
                author: { displayName: "WHICH_MANAGER", isManager: true },
                body: "내가 쓴 댓글",
                visibility: "VISIBLE",
                threadState: "OPEN",
                createdAt: "2026-08-24T08:00:00.000Z",
                editedAt: null,
                reactions: { helpfulCount: 0, dislikeCount: 0, viewerReaction: null },
                reports: { viewerReported: false, canReport: false },
                permissions: { canEdit: true, canDelete: true },
                replies: [
                  {
                    id: "remaining-reply",
                    choice: "A",
                    author: { displayName: "답글 작성자" },
                    body: "삭제 후에도 남는 답글",
                    visibility: "VISIBLE",
                    threadState: "OPEN",
                    createdAt: "2026-08-24T08:10:00.000Z",
                    editedAt: null,
                    parentCommentId: "own-comment",
                    reactions: { helpfulCount: 0, dislikeCount: 0, viewerReaction: null },
                    reports: { viewerReported: false, canReport: true },
                    permissions: { canEdit: false, canDelete: false },
                    replies: [],
                  },
                ],
              },
            ],
            nextCursor: null,
          });
        }
        if (url === "/api/comments/own-comment" && init?.method === "PATCH") {
          mutationMethods.push("PATCH");
          return jsonResponse({
            comment: {
              id: "own-comment",
              body: "수정된 내 댓글",
              editedAt: "2026-08-24T08:30:00.000Z",
            },
          });
        }
        if (url === "/api/comments/own-comment" && init?.method === "DELETE") {
          mutationMethods.push("DELETE");
          return jsonResponse({ comment: { id: "own-comment", deleted: true } });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    expect(await screen.findByText("내가 쓴 댓글")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "WHICH 관리자" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    const editor = screen.getByRole("textbox", { name: "댓글 수정 내용" });
    fireEvent.change(editor, { target: { value: "수정된 내 댓글" } });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    expect(await screen.findByText("수정된 내 댓글", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("수정됨")).toBeInTheDocument();
    expect(screen.getByText("댓글을 수정했어요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(
      screen.getByText("이 댓글을 삭제할까요? 삭제한 내용은 다시 표시되지 않아요."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "댓글 삭제 확인" }));

    expect(await screen.findByText("댓글을 삭제했어요.")).toBeInTheDocument();
    expect(screen.queryByText("수정된 내 댓글")).not.toBeInTheDocument();
    expect(screen.getByText("작성자가 삭제한 댓글입니다.")).toBeInTheDocument();
    expect(screen.getByText("삭제 후에도 남는 답글")).toBeInTheDocument();
    expect(mutationMethods).toEqual(["PATCH", "DELETE"]);
  });

  it("optimistically toggles 공감 and reconciles the server count", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-reaction",
      voteId: "vote-reaction",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));
    const reactionRequests: RequestInit[] = [];
    const commentListUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({ code: "SESSION_INVALID", message: "guest" }, 401);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          commentListUrls.push(url);
          return jsonResponse({
            items: [
              {
                id: "reaction-comment",
                choice: "A",
                author: { displayName: "작성자" },
                body: "공감 테스트 댓글",
                threadState: "OPEN",
                createdAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
                editedAt: null,
                reactions: { helpfulCount: 2, dislikeCount: 0, viewerReaction: null },
              },
            ],
            nextCursor: null,
            totalCount: 7,
          });
        }
        if (url === "/api/comments/reaction-comment/reactions/helpful") {
          reactionRequests.push(init ?? {});
          return jsonResponse({
            reaction: { code: "HELPFUL", active: true, helpfulCount: 3, dislikeCount: 0 },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    await screen.findByRole("button", { name: "공감 2" });
    expect(screen.getByText("1시간 전")).toBeInTheDocument();
    expect(screen.getByText("전체 댓글", { exact: false })).toHaveTextContent("7개");
    expect(screen.getByRole("button", { name: "싫어요 0" }).querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("dislike.png"),
    );

    fireEvent.click(screen.getByRole("button", { name: "공감순" }));
    await waitFor(() =>
      expect(commentListUrls.some((url) => url.includes("sort=HELPFUL"))).toBe(true),
    );

    fireEvent.click(await screen.findByRole("button", { name: "공감 2" }));

    const activeReaction = await screen.findByRole("button", { name: "공감 3" });
    expect(activeReaction).toHaveAttribute("aria-pressed", "true");
    expect(reactionRequests).toHaveLength(1);
    expect(new Headers(reactionRequests[0]?.headers).get("idempotency-key")).toEqual(
      expect.any(String),
    );
  });

  it("submits a fixed Comment report reason and collapses the card from the server result", async () => {
    const savedResult: VoteResponse = {
      outcome: "ACCEPTED",
      voteAttemptId: "attempt-report",
      voteId: "vote-report",
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
    sessionStorage.setItem(`which:vote-result:${ISSUE_ID}`, JSON.stringify(savedResult));
    const reportRequests: RequestInit[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/guest-subjects") return jsonResponse({ status: "ready" });
        if (url.endsWith(`/api/issues/${ISSUE_ID}`)) return jsonResponse(issue);
        if (url === "/api/member-session") {
          return jsonResponse({ code: "SESSION_INVALID", message: "guest" }, 401);
        }
        if (url.startsWith(`/api/issues/${ISSUE_ID}/comments?`)) {
          return jsonResponse({
            items: [
              {
                id: "reported-comment",
                choice: "A",
                author: { displayName: "작성자" },
                body: "신고 테스트 댓글",
                visibility: "VISIBLE",
                threadState: "OPEN",
                createdAt: "2026-08-18T02:00:00.000Z",
                editedAt: null,
                reactions: { helpfulCount: 0, dislikeCount: 0, viewerReaction: null },
                reports: { viewerReported: false, canReport: true },
              },
            ],
            nextCursor: null,
          });
        }
        if (url === "/api/comments/reported-comment/reports") {
          reportRequests.push(init ?? {});
          return jsonResponse(
            {
              report: { accepted: true, viewerReported: true },
              comment: { visibility: "COLLAPSED" },
            },
            201,
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<IssueExperience issueId={ISSUE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "신고" }));
    fireEvent.click(screen.getByRole("button", { name: "신고 접수" }));

    expect(
      await screen.findByText("여러 신고가 접수되어 내용을 접어 두었어요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "신고 완료" })).toBeDisabled();
    expect(reportRequests).toHaveLength(1);
    expect(new Headers(reportRequests[0]?.headers).get("idempotency-key")).toEqual(
      expect.any(String),
    );
    expect(JSON.parse(String(reportRequests[0]?.body))).toEqual({ reason: "SPAM" });
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });
});

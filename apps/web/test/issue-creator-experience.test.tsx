import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueCreatorExperience } from "@/features/issues/issue-creator-experience";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const registry = {
  taxonomyVersion: "interest_cards_v1",
  minSelections: 3,
  maxSelections: 8,
  cards: [
    { code: "DAILY_LIFE", label: "생활", categoryCodes: ["LIFE"], topicCodes: ["DAILY"] },
    { code: "FOOD", label: "음식", categoryCodes: ["LIFE"], topicCodes: ["FOOD"] },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  navigation.push.mockReset();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("IssueCreatorExperience", () => {
  it("directs a Guest to login while preserving the return path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "/api/member-session") return jsonResponse({}, 401);
        if (String(input) === "/api/interests/cards") return jsonResponse(registry);
        throw new Error("unexpected request");
      }),
    );
    render(<IssueCreatorExperience />);

    const link = await screen.findByRole("link", { name: /로그인하고 질문 만들기/ });
    expect(link).toHaveAttribute("href", "/login?returnTo=%2Fcreate");
  });

  it("publishes a Member draft and opens the new Issue", async () => {
    const submissions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ member: { status: "ACTIVE" } });
        if (url === "/api/interests/cards") return jsonResponse(registry);
        if (url === "/api/issues") {
          submissions.push(JSON.parse(String(init?.body)));
          expect(new Headers(init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
          return jsonResponse({ created: true, issue: { id: "new-issue-id" } }, 201);
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    render(<IssueCreatorExperience />);

    const question = await screen.findByPlaceholderText("예: 퇴근 후 바로 잘까, 조금 더 놀까?");
    fireEvent.change(question, { target: { value: "오늘 저녁은 무엇을 먹을까" } });
    fireEvent.change(screen.getByPlaceholderText("바로 자기"), { target: { value: "라면" } });
    fireEvent.change(screen.getByPlaceholderText("조금 더 놀기"), { target: { value: "김밥" } });
    fireEvent.click(screen.getByRole("radio", { name: "음식" }));
    fireEvent.click(screen.getByRole("button", { name: "질문 게시하기" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      question: "오늘 저녁은 무엇을 먹을까",
      choiceA: "라면",
      choiceB: "김밥",
      interestCardCode: "FOOD",
    });
    expect(navigation.push).toHaveBeenCalledWith("/issues/new-issue-id");
    expect(window.sessionStorage.getItem("which_issue_draft_v1")).toBeNull();
  });

  it("publishes with one approved Library pair without requesting another review", async () => {
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/member-session") return jsonResponse({ member: { status: "ACTIVE" } });
        if (url === "/api/interests/cards") return jsonResponse(registry);
        if (url.startsWith("/api/issue-media-library?")) {
          return jsonResponse({
            items: [
              {
                id: "1dcb8f5b-d722-45a6-a9d9-0bfb793af24e",
                title: "도시와 자연",
                categoryCode: "LIFE",
                topics: ["일상", "공간"],
                status: "PUBLISHED",
                usageCount: 0,
                createdAt: "2026-08-29T00:00:00.000Z",
                assets: [
                  {
                    id: "a4c3de16-c9d2-43d5-a11a-f3a9b7fdfb78",
                    side: "A",
                    mediaAssetId: "4132956e-8291-4793-97b7-1cb4fef82669",
                    url: "https://media.whichone.site/library/city.webp",
                    altText: "도시 야경",
                    cropMode: "COVER",
                    width: 1200,
                    height: 800,
                    attributionText: null,
                  },
                  {
                    id: "d521347b-a87c-4565-9a46-bd38274db0c4",
                    side: "B",
                    mediaAssetId: "cce1cf7b-b44c-4650-b873-d9433a281282",
                    url: "https://media.whichone.site/library/forest.webp",
                    altText: "숲길",
                    cropMode: "COVER",
                    width: 1200,
                    height: 800,
                    attributionText: null,
                  },
                ],
              },
            ],
          });
        }
        if (url === "/api/issues") {
          submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return jsonResponse({ created: true, issue: { id: "library-issue-id" } }, 201);
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    render(<IssueCreatorExperience />);

    fireEvent.change(await screen.findByPlaceholderText("예: 퇴근 후 바로 잘까, 조금 더 놀까?"), {
      target: { value: "쉬는 날에는 어디로 갈까" },
    });
    fireEvent.change(screen.getByPlaceholderText("바로 자기"), {
      target: { value: "도시" },
    });
    fireEvent.change(screen.getByPlaceholderText("조금 더 놀기"), {
      target: { value: "자연" },
    });
    fireEvent.click(screen.getByRole("button", { name: "승인 이미지 Library" }));
    fireEvent.click(await screen.findByRole("button", { name: /도시와 자연/ }));
    fireEvent.click(screen.getByRole("button", { name: "질문 게시하기" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      question: "쉬는 날에는 어디로 갈까",
      choiceA: "도시",
      choiceB: "자연",
      libraryPairId: "1dcb8f5b-d722-45a6-a9d9-0bfb793af24e",
    });
    expect(submissions[0]).not.toHaveProperty("mediaAssetAId");
    expect(submissions[0]).not.toHaveProperty("mediaAssetBId");
    expect(navigation.push).toHaveBeenCalledWith("/issues/library-issue-id");
  });
});

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
});

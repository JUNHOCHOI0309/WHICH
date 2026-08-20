import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InterestSelector } from "@/features/interests/interest-selector";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const cards = [
  { code: "FOOD", label: "음식", categoryCodes: ["LIFE"], topicCodes: ["FOOD"] },
  { code: "GAME", label: "게임", categoryCodes: ["CULTURE_ENT"], topicCodes: ["GAME"] },
  { code: "TECH", label: "IT·테크", categoryCodes: ["TECH"], topicCodes: ["AI"] },
  { code: "SPORTS", label: "스포츠", categoryCodes: ["SPORTS"], topicCodes: ["MATCH"] },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InterestSelector", () => {
  it("shows only after first value, requires three cards, and records completion", async () => {
    const events: string[] = [];
    const saves: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/interests/cards") {
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            minSelections: 3,
            maxSelections: 8,
            cards,
          });
        }
        if (url === "/api/interest-profile" && init?.method !== "PUT") {
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            onboardingState: "NOT_STARTED",
            selectedCardCodes: [],
            canSkip: true,
            profileVersion: 1,
            mergeCandidate: null,
          });
        }
        if (url === "/api/interest-profile" && init?.method === "PUT") {
          saves.push(JSON.parse(String(init.body)));
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            onboardingState: "COMPLETED",
            selectedCardCodes: ["FOOD", "GAME", "TECH"],
            canSkip: true,
            profileVersion: 2,
            mergeCandidate: null,
          });
        }
        if (url === "/api/analytics/events") {
          events.push((JSON.parse(String(init?.body)) as { eventType: string }).eventType);
          return jsonResponse({ accepted: true, duplicate: false });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <InterestSelector
        mode="prompt"
        analyticsContext={{ issueId: "591f2e90-996a-50c5-af46-967dd0793000", issueVersion: 1 }}
      />,
    );

    expect(await screen.findByText("다음 질문을 더 잘 골라드릴까요?")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "선택 저장" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "음식" }));
    fireEvent.click(screen.getByRole("button", { name: "게임" }));
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "IT·테크" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
    });
    await waitFor(() =>
      expect(events).toEqual(
        expect.arrayContaining(["INTEREST_PROMPT_VIEW", "INTEREST_SELECTION_COMPLETE"]),
      ),
    );
  });

  it("does not reopen the inline prompt after the Guest chose later", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "/api/interests/cards") {
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            minSelections: 3,
            maxSelections: 8,
            cards,
          });
        }
        return jsonResponse({
          taxonomyVersion: "interest_cards_v1",
          onboardingState: "SKIPPED",
          selectedCardCodes: [],
          canSkip: true,
          profileVersion: 2,
          mergeCandidate: null,
        });
      }),
    );

    render(<InterestSelector mode="prompt" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("다음 질문을 더 잘 골라드릴까요?")).not.toBeInTheDocument();
  });

  it("lets a Member selectively confirm linked Guest interests", async () => {
    const mergeBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/interests/cards") {
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            minSelections: 3,
            maxSelections: 8,
            cards: [
              ...cards,
              { code: "DAILY_LIFE", label: "생활", categoryCodes: ["LIFE"], topicCodes: [] },
              { code: "TRAVEL", label: "여행", categoryCodes: ["LIFE"], topicCodes: [] },
            ],
          });
        }
        if (url === "/api/interest-profile/merge") {
          mergeBodies.push(JSON.parse(String(init?.body)));
          return jsonResponse({
            taxonomyVersion: "interest_cards_v1",
            onboardingState: "COMPLETED",
            selectedCardCodes: ["DAILY_LIFE", "FOOD", "SPORTS", "TRAVEL"],
            canSkip: false,
            profileVersion: 3,
            mergeCandidate: null,
          });
        }
        return jsonResponse({
          taxonomyVersion: "interest_cards_v1",
          onboardingState: "COMPLETED",
          selectedCardCodes: ["DAILY_LIFE", "SPORTS", "TRAVEL"],
          canSkip: false,
          profileVersion: 2,
          mergeCandidate: {
            anonymousSubjectId: "591f2e90-996a-50c5-af46-967dd0793000",
            guestCardCodes: ["FOOD", "GAME"],
            suggestedCardCodes: ["FOOD", "GAME"],
          },
        });
      }),
    );

    render(<InterestSelector mode="settings" />);

    const mergeChoices = await screen.findByLabelText("병합할 Guest 관심사");
    fireEvent.click(within(mergeChoices).getByRole("button", { name: "게임" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 Guest 관심사 추가" }));

    await waitFor(() => expect(mergeBodies).toHaveLength(1));
    expect(mergeBodies[0]).toEqual({
      anonymousSubjectId: "591f2e90-996a-50c5-af46-967dd0793000",
      selectedCardCodes: ["FOOD"],
    });
  });
});

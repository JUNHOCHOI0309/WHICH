import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreatorProfileExperience } from "@/features/identity/creator-profile-experience";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creator public profile experience", () => {
  it("shows safe Creator stats and links to authored Issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          creator: {
            displayName: "테크 질문가",
            handle: "tech_creator",
            bio: "기술의 두 선택지를 묻습니다.",
            joinedMonth: "2026-08",
            avatar: { kind: "INITIALS", initials: "테질" },
          },
          stats: { publishedIssueCount: 1, acceptedVoteCount: 9 },
          issues: [
            {
              id: "591f2e90-996a-50c5-af46-967dd0793000",
              version: 1,
              question: "Creator가 만든 공개 질문",
              categoryCode: "TECH",
              publishedAt: "2026-08-22T03:00:00.000Z",
              acceptedVoteCount: 9,
            },
          ],
        }),
      ),
    );

    render(<CreatorProfileExperience handle="tech_creator" />);

    expect(await screen.findByRole("heading", { name: "테크 질문가" })).toBeVisible();
    expect(screen.getByText("@tech_creator")).toBeVisible();
    expect(screen.getByText("기술의 두 선택지를 묻습니다.")).toBeVisible();
    expect(screen.getByText("Creator가 만든 공개 질문")).toBeVisible();
    expect(screen.getByRole("link", { name: "질문 참여하기 →" })).toHaveAttribute(
      "href",
      "/issues/591f2e90-996a-50c5-af46-967dd0793000",
    );
    expect(screen.getByText("선택 기록은 공개되지 않아요")).toBeVisible();
  });

  it("does not reveal whether a missing profile is private", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "PROFILE_NOT_FOUND", message: "missing" }, 404)),
    );

    render(<CreatorProfileExperience handle="hidden_creator" />);

    expect(await screen.findByText("공개된 작성자 프로필이 없어요.")).toBeVisible();
    expect(screen.getByText(/비공개로 전환했을 수 있습니다/)).toBeVisible();
  });
});

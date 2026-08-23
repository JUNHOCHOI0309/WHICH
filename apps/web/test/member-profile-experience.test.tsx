import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberProfileExperience } from "@/features/identity/member-profile-experience";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Member private profile experience", () => {
  it("explains the private boundary and offers login to a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID", message: "login" }, 401)),
    );

    render(<MemberProfileExperience kakaoLoginEnabled naverLoginEnabled />);

    expect(await screen.findByText("로그인하면 내 선택이 이어져요.")).toBeVisible();
    expect(screen.getByText(/전체 투표 기록은 다른 사람에게 공개되지 않습니다/)).toBeVisible();
    expect(screen.getByRole("link", { name: "로그인 또는 빠른 회원가입" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fme",
    );
    expect(screen.getAllByRole("link", { name: "관심사" })).toHaveLength(2);
  });

  it("shows only the current Member's profile and accepted vote history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          member: {
            id: "member-1",
            displayName: "테스트 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 1,
          },
          publicProfile: null,
          identities: [
            {
              provider: "GOOGLE",
              linkedAt: "2026-08-01T00:00:00.000Z",
              lastAuthenticatedAt: "2026-08-20T00:00:00.000Z",
            },
          ],
          votes: {
            items: [
              {
                voteId: "vote-1",
                issueId: "591f2e90-996a-50c5-af46-967dd0793000",
                issueVersion: 1,
                question: "아침형 인간 vs 저녁형 인간",
                categoryCode: "DAILY_LIFE",
                choice: "B",
                choiceLabel: "저녁형 인간",
                acceptedAt: "2026-08-20T09:00:00.000Z",
                result: {
                  resultVersion: 2,
                  acceptedA: 4,
                  acceptedB: 6,
                  displayedTotal: 10,
                  integrityState: "NORMAL",
                },
              },
            ],
            nextCursor: null,
          },
        }),
      ),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);

    expect(await screen.findByRole("heading", { name: "테스트 회원님의 선택" })).toBeVisible();
    expect(screen.getByText("아침형 인간 vs 저녁형 인간")).toBeVisible();
    expect(screen.getByText("저녁형 인간")).toBeVisible();
    expect(screen.getByText("60%")).toBeVisible();
    expect(screen.getByRole("link", { name: /최신 결과 보기/ })).toHaveAttribute(
      "href",
      "/issues/591f2e90-996a-50c5-af46-967dd0793000",
    );
    expect(screen.getByText("선택 기록은 공개 프로필과 분리됩니다.")).toBeVisible();
    expect(screen.getByText("Google").closest("article")).toHaveTextContent("연결됨");
    expect(screen.getByText("X").closest("article")).toHaveTextContent("연결되지 않음");
    expect(screen.getByText("X").closest("article")?.querySelector("a")).toHaveAttribute(
      "href",
      "/api/auth/x/start?returnTo=%2Fme%23connected-accounts&intent=link",
    );
  });

  it("explains when an existing Member needs reviewed account merging", async () => {
    window.history.replaceState({}, "", "/me?auth=merge-review#connected-accounts");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          member: {
            id: "member-1",
            displayName: "병합 검토 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [
            {
              provider: "NAVER",
              linkedAt: "2026-08-01T00:00:00.000Z",
              lastAuthenticatedAt: "2026-08-22T00:00:00.000Z",
            },
          ],
          votes: { items: [], nextCursor: null },
        }),
      ),
    );

    render(<MemberProfileExperience kakaoLoginEnabled naverLoginEnabled />);

    expect(
      await screen.findByText("이 계정에는 별도 활동 또는 충돌이 있어 자동 병합하지 않았습니다."),
    ).toHaveAttribute("role", "alert");
  });

  it("creates a public Creator profile from the private Me surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/me/profile" && init?.method === "PATCH") {
          return jsonResponse({
            handle: "question_maker",
            bio: "좋은 질문을 만듭니다.",
            visibility: "PUBLIC",
            publicUrl: "/user/question_maker",
          });
        }
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "질문 작성자",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);

    const handle = await screen.findByRole("textbox", { name: /Handle/ });
    fireEvent.change(handle, { target: { value: "question_maker" } });
    fireEvent.change(screen.getByRole("textbox", { name: /짧은 소개/ }), {
      target: { value: "좋은 질문을 만듭니다." },
    });
    fireEvent.click(screen.getByRole("radio", { name: /^공개 —/ }));
    fireEvent.click(screen.getByRole("button", { name: "프로필 저장" }));

    expect(await screen.findByText("공개 프로필을 저장했어요.")).toBeVisible();
    expect(screen.getByRole("link", { name: /공개 화면 보기/ })).toHaveAttribute(
      "href",
      "/user/question_maker",
    );
  });

  it("clears the private view after logout", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "로그아웃 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(screen.getByText("로그인하면 내 선택이 이어져요.")).toBeVisible());
    const logoutRequest = requests.find((request) => request.init?.method === "DELETE");
    expect(logoutRequest?.url).toBe("/api/member-session");
    expect(logoutRequest?.init).toMatchObject({
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(new Headers(logoutRequest?.init?.headers).get("x-which-csrf")).toBe(
      "member-session-logout",
    );
  });

  it.each([
    { name: "HTTP failure", response: () => jsonResponse({ code: "FAILED" }, 502) },
    { name: "network failure", response: () => Promise.reject(new Error("offline")) },
  ])("keeps the private view after a $name", async ({ response }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "DELETE") return response();
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "로그아웃 유지 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience naverLoginEnabled={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그아웃하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "로그아웃 유지 회원님의 선택" })).toBeVisible();
    expect(screen.queryByText("로그인하면 내 선택이 이어져요.")).not.toBeInTheDocument();
  });
});

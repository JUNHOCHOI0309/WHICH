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

    render(<MemberProfileExperience />);

    expect(await screen.findByText("로그인하면 내 선택이 이어져요.")).toBeVisible();
    expect(screen.getByText(/전체 투표 기록은 다른 사람에게 공개되지 않습니다/)).toBeVisible();
    expect(screen.getByRole("link", { name: "로그인 또는 빠른 회원가입" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fme",
    );
    expect(screen.getAllByRole("link", { name: "관심사" })).toHaveLength(2);
  });

  it("shows only the current Member's profile and accepted vote history", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input));
        return jsonResponse({
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
        });
      }),
    );

    render(<MemberProfileExperience />);

    expect(await screen.findByRole("heading", { name: "테스트 회원님의 선택" })).toBeVisible();
    expect(screen.getByText("아침형 인간 vs 저녁형 인간")).toBeVisible();
    expect(screen.getByText("저녁형 인간")).toBeVisible();
    expect(screen.getByText("60%")).toBeVisible();
    expect(screen.getByRole("link", { name: /최신 결과 보기/ })).toHaveAttribute(
      "href",
      "/issues/591f2e90-996a-50c5-af46-967dd0793000",
    );
    expect(screen.getByText("선택 기록은 공개 프로필과 분리됩니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: /전체 투표 기록 보기/ })).toHaveAttribute(
      "href",
      "/me/votes",
    );
    expect(screen.getByRole("link", { name: "프로필" })).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("heading", { name: "이메일 로그인을 WHICH 계정에 연결해요." }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "이메일 로그인 연결" })).toBeVisible();
    expect(requests).toContain("/api/me?limit=3");
    expect(screen.queryByRole("heading", { name: "로그인 수단 연결" })).not.toBeInTheDocument();
  });

  it("keeps the complete private profile after changing only the avatar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/me/avatar" && init?.method === "PUT") {
          return jsonResponse({
            member: {
              id: "member-1",
              displayName: "이미지 변경 회원",
              status: "ACTIVE",
              avatar: { kind: "IMAGE", url: "https://images.whichone.site/avatar.webp" },
              avatarSource: "CUSTOM",
            },
          });
        }
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "이미지 변경 회원",
            status: "ACTIVE",
            avatar: { kind: "INITIALS", initials: "이미" },
            avatarSource: "INITIALS",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 3,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience />);

    expect(await screen.findByRole("heading", { name: "이미지 변경 회원님의 선택" })).toBeVisible();
    const fileInput = screen.getByLabelText("프로필 이미지 선택 또는 변경");
    expect(fileInput).toHaveAttribute("accept", "image/jpeg,image/png");
    fireEvent.change(fileInput, {
      target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("프로필 이미지를 변경했습니다.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "이미지 변경 회원님의 선택" })).toBeVisible();
    expect(screen.getByText(/2026년 8월부터 WHICH에 참여했어요/)).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByRole("img", { name: "이미지 변경 회원 프로필" })).toHaveAttribute(
      "src",
      "https://images.whichone.site/avatar.webp",
    );
    expect(screen.getByRole("button", { name: "프로필 이미지 삭제" })).toBeVisible();
    expect(screen.queryByText("변경")).not.toBeInTheDocument();
    expect(screen.queryByText("PROFILE IMAGE")).not.toBeInTheDocument();
    expect(screen.queryByText(/512px WebP로 자동 변환/)).not.toBeInTheDocument();
  });

  it("removes an existing avatar from the profile circle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/me/avatar" && init?.method === "DELETE") {
          return jsonResponse({
            member: {
              id: "member-1",
              displayName: "이미지 삭제 회원",
              status: "ACTIVE",
              avatar: { kind: "INITIALS", initials: "이미" },
              avatarSource: "INITIALS",
            },
          });
        }
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "이미지 삭제 회원",
            status: "ACTIVE",
            avatar: { kind: "IMAGE", url: "https://images.whichone.site/avatar.webp" },
            avatarSource: "CUSTOM",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 1,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience />);

    expect(await screen.findByRole("img", { name: "이미지 삭제 회원 프로필" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "프로필 이미지 삭제" }));

    expect(await screen.findByText("프로필 이미지를 비웠습니다.")).toBeVisible();
    expect(screen.queryByRole("img", { name: "이미지 삭제 회원 프로필" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "프로필 이미지 삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "이미지 삭제 회원님의 선택" })).toBeVisible();
  });

  it("offers change without delete for the initial social avatar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          member: {
            id: "member-1",
            displayName: "소셜 이미지 회원",
            status: "ACTIVE",
            avatar: { kind: "IMAGE", url: "https://images.whichone.site/social-avatar.webp" },
            avatarSource: "SOCIAL",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [],
          votes: { items: [], nextCursor: null },
        }),
      ),
    );

    render(<MemberProfileExperience />);

    expect(await screen.findByRole("img", { name: "소셜 이미지 회원 프로필" })).toBeVisible();
    expect(screen.getByText("변경")).toBeVisible();
    expect(screen.queryByRole("button", { name: "프로필 이미지 삭제" })).not.toBeInTheDocument();
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

    render(<MemberProfileExperience />);

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

    render(<MemberProfileExperience />);
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

    render(<MemberProfileExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그아웃하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "로그아웃 유지 회원님의 선택" })).toBeVisible();
    expect(screen.queryByText("로그인하면 내 선택이 이어져요.")).not.toBeInTheDocument();
  });

  it("requires reauthentication and explicit confirmation before deleting an account", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (String(input) === "/api/me" && init?.method === "DELETE") {
          return jsonResponse({ deleted: true });
        }
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "탈퇴 테스트 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 1,
          },
          publicProfile: null,
          identities: [
            {
              provider: "EMAIL",
              linkedAt: "2026-08-01T00:00:00.000Z",
              lastAuthenticatedAt: "2026-08-20T00:00:00.000Z",
            },
          ],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience />);

    fireEvent.click(await screen.findByRole("button", { name: "회원 탈퇴" }));
    const submit = screen.getByRole("button", { name: "회원 탈퇴 확정" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("현재 비밀번호"), {
      target: { value: "correct password" },
    });
    fireEvent.change(screen.getByLabelText(/탈퇴합니다/), {
      target: { value: "탈퇴합니다" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(await screen.findByText("회원 탈퇴가 완료되었습니다.")).toBeVisible();
    expect(screen.getByText(/기존 투표와 댓글은 탈퇴한 사용자로 익명화/)).toBeVisible();
    const deletionRequest = requests.find(
      (request) => request.url === "/api/me" && request.init?.method === "DELETE",
    );
    expect(deletionRequest?.init).toMatchObject({
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(new Headers(deletionRequest?.init?.headers).get("x-which-csrf")).toBe(
      "member-account-delete",
    );
    expect(JSON.parse(String(deletionRequest?.init?.body))).toEqual({
      password: "correct password",
      confirmation: "탈퇴합니다",
    });
  });

  it("keeps the account screen when the deletion password is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/me" && init?.method === "DELETE") {
          return jsonResponse({ code: "CREDENTIAL_INVALID" }, 401);
        }
        return jsonResponse({
          member: {
            id: "member-1",
            displayName: "유지 회원",
            status: "ACTIVE",
            joinedAt: "2026-08-01T00:00:00.000Z",
            participationCount: 0,
          },
          publicProfile: null,
          identities: [
            {
              provider: "EMAIL",
              linkedAt: "2026-08-01T00:00:00.000Z",
              lastAuthenticatedAt: "2026-08-20T00:00:00.000Z",
            },
          ],
          votes: { items: [], nextCursor: null },
        });
      }),
    );

    render(<MemberProfileExperience />);
    fireEvent.click(await screen.findByRole("button", { name: "회원 탈퇴" }));
    fireEvent.change(screen.getByLabelText("현재 비밀번호"), {
      target: { value: "wrong password" },
    });
    fireEvent.change(screen.getByLabelText(/탈퇴합니다/), {
      target: { value: "탈퇴합니다" },
    });
    fireEvent.click(screen.getByRole("button", { name: "회원 탈퇴 확정" }));

    expect(await screen.findByText("현재 비밀번호가 올바르지 않습니다.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "유지 회원님의 선택" })).toBeVisible();
  });
});

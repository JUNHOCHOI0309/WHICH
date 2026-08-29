import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhichShell } from "@/components/layout/which-shell";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const defaultInnerWidth = window.innerWidth;

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function activeMemberResponse(input: string | URL | Request) {
  const url = String(input);
  if (url === "/api/member-session") {
    return jsonResponse({
      member: { id: "member-1", displayName: "테스트 회원", status: "ACTIVE" },
    });
  }
  if (url === "/api/me/notifications") {
    return jsonResponse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      unreadCount: 0,
      items: [],
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
  throw new Error(`Unexpected request: ${url}`);
}

afterEach(() => {
  navigation.push.mockReset();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: defaultInnerWidth });
});

describe("Member navigation", () => {
  it("offers login and preserves the current page for a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID" }, 401)),
    );
    window.history.replaceState({}, "", "/issues/issue-1");

    render(<WhichShell active="home">내용</WhichShell>);

    await waitFor(() => {
      const links = screen.getAllByRole("link", { name: "로그인" });
      expect(links).toHaveLength(3);
      expect(
        links.every((link) => link.getAttribute("href") === "/login?returnTo=%2Fissues%2Fissue-1"),
      ).toBe(true);
    });

    const mobileNavigation = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    expect(
      within(mobileNavigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["⌂홈", "#관심사", "◎로그인"]);
    expect(within(mobileNavigation).queryByRole("button", { name: "질문" })).toBeNull();
  });

  it("offers private records to an authenticated Member", async () => {
    vi.stubGlobal("fetch", vi.fn(activeMemberResponse));

    render(<WhichShell active="home">내용</WhichShell>);

    const links = await screen.findAllByRole("link", { name: "내 기록" });
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.getAttribute("href") === "/me")).toBe(true);
  });

  it("shows Member notices, marks all read on demand, and toggles the panel from the bell", async () => {
    const noticeId = "05739bff-8463-4474-a0c1-3f67ae75d586";
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({
          url,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url === "/api/member-session") {
          return jsonResponse({
            member: { id: "member-1", displayName: "테스트 회원", status: "ACTIVE" },
          });
        }
        if (url === "/api/me/notifications" && method === "PATCH") {
          return jsonResponse({ updated: 1 });
        }
        if (url === "/api/me/notifications") {
          return jsonResponse({
            schemaVersion: 1,
            generatedAt: "2026-08-29T03:00:00.000Z",
            unreadCount: 1,
            items: [
              {
                id: noticeId,
                targetType: "ISSUE_MEDIA_ASSET",
                targetId: "dd353808-7318-45a5-83f0-91a04143322e",
                policyVersion: "which-moderation-v1",
                reasonCode: "ASSET_APPROVED",
                actionType: "APPROVED",
                summary: "이미지 검수가 승인됐어요.",
                nextStep: "질문 공개 상태를 확인해 주세요.",
                effectiveAt: "2026-08-29T02:59:00.000Z",
                expiresAt: null,
                readAt: null,
                createdAt: "2026-08-29T02:59:00.000Z",
              },
            ],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<WhichShell active="home">내용</WhichShell>);

    const button = await screen.findByRole("button", { name: "알림 1개" });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "알림" });
    expect(within(dialog).getByText("이미지 검수가 승인됐어요.")).toBeInTheDocument();
    expect(within(dialog).getByText("질문 공개 상태를 확인해 주세요.")).toBeInTheDocument();
    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    expect(within(dialog).queryByRole("button", { name: "알림 닫기" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "모두 읽기" }));
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.url === "/api/me/notifications" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) === JSON.stringify({ noticeIds: [noticeId] }),
        ),
      ).toBe(true);
    });
    expect(within(dialog).getByText("새 알림이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "알림" }));
    expect(screen.queryByRole("dialog", { name: "알림" })).not.toBeInTheDocument();
  });

  it("does not expose the moderation notification control to a Guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "SESSION_INVALID" }, 401)),
    );

    render(<WhichShell active="home">내용</WhichShell>);

    await screen.findAllByRole("link", { name: "로그인" });
    expect(screen.queryByRole("button", { name: /^알림/ })).not.toBeInTheDocument();
  });

  it("opens and closes a preserved mobile aside from its edge control", async () => {
    vi.stubGlobal("fetch", vi.fn(activeMemberResponse));

    render(
      <WhichShell active="me" aside={<div>포인트 원장</div>} preserveAsideOnNarrow>
        내용
      </WhichShell>,
    );

    const trigger = screen.getByRole("button", { name: "W Point 내역 열기" });
    const aside = screen.getByRole("complementary", { name: "WHICH 안내" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(aside).toHaveAttribute("data-mobile-open", "true");
    fireEvent.click(within(aside).getByRole("button", { name: "W Point 패널 닫기" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the preserved mobile aside after a right-edge swipe to the left", async () => {
    vi.stubGlobal("fetch", vi.fn(activeMemberResponse));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    render(
      <WhichShell active="me" aside={<div>포인트 원장</div>} preserveAsideOnNarrow>
        내용
      </WhichShell>,
    );

    const page = screen.getByRole("main");
    const trigger = screen.getByRole("button", { name: "W Point 내역 열기" });
    fireEvent.touchStart(page, { touches: [{ clientX: 386, clientY: 260 }] });
    fireEvent.touchMove(page, { touches: [{ clientX: 300, clientY: 264 }] });
    fireEvent.touchEnd(page);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps Question in the Member mobile navigation and routes unsupported pages home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ member: { id: "member-1", displayName: "테스트 회원", status: "ACTIVE" } }),
      ),
    );
    window.history.replaceState({}, "", "/interests");

    render(<WhichShell active="interests">내용</WhichShell>);

    const mobileNavigation = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    const questionLink = await within(mobileNavigation).findByRole("link", { name: "질문" });
    expect(within(mobileNavigation).getAllByRole("link")).toHaveLength(4);
    expect(questionLink).toHaveAttribute("href", "/?compose=question");
    expect(screen.queryByRole("dialog", { name: "Question" })).not.toBeInTheDocument();
  });

  it("opens Question in place from the Member records page", async () => {
    vi.stubGlobal("fetch", vi.fn(activeMemberResponse));
    window.history.replaceState({}, "", "/me");

    render(
      <WhichShell active="me" creationEnabled>
        내용
      </WhichShell>,
    );

    const mobileNavigation = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    fireEvent.click(await within(mobileNavigation).findByRole("button", { name: "질문" }));

    expect(await screen.findByRole("dialog", { name: "Question" })).toBeInTheDocument();
  });

  it("opens Question after the mobile navigation returns to home", async () => {
    vi.stubGlobal("fetch", vi.fn(activeMemberResponse));
    window.history.replaceState({}, "", "/?compose=question");

    render(
      <WhichShell active="home" creationEnabled>
        내용
      </WhichShell>,
    );

    expect(await screen.findByRole("dialog", { name: "Question" })).toBeInTheDocument();
  });
});

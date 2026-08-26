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

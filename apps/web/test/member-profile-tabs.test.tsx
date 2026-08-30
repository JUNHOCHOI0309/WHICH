import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberProfileTabs } from "@/features/identity/member-profile-tabs";

afterEach(cleanup);
describe("shared Member profile tabs", () => {
  it.each(["profile", "votes", "submissions"] as const)(
    "keeps the same order and design on %s",
    (active) => {
      render(<MemberProfileTabs active={active} creationEnabled />);
      const links = within(screen.getByRole("navigation", { name: "내 기록 메뉴" })).getAllByRole(
        "link",
      );
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/me",
        "/me/votes",
        "/me/submissions",
      ]);
      expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
      expect(links[["profile", "votes", "submissions"].indexOf(active)]).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );
  it("preserves the creation feature flag outside the existing submissions page", () => {
    render(<MemberProfileTabs active="votes" />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "내 질문" })).not.toBeInTheDocument();
  });
});

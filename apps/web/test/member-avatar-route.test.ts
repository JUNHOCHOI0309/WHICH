import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const avatarBridge = vi.hoisted(() => ({
  uploadMemberAvatar: vi.fn(),
  removeMemberAvatar: vi.fn(),
}));

vi.mock("@/lib/server/member-avatar-bridge", () => ({
  uploadMemberAvatar: avatarBridge.uploadMemberAvatar,
  removeMemberAvatar: avatarBridge.removeMemberAvatar,
}));

import { DELETE, PUT } from "@/app/api/me/avatar/route";

const member = {
  id: "591f2e90-996a-50c5-af46-967dd0793000",
  displayName: "프로필 회원",
  status: "ACTIVE" as const,
  avatar: { kind: "IMAGE" as const, url: "https://images.whichone.site/avatar.webp" },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Member avatar BFF", () => {
  it("accepts a same-origin JPG/PNG upload with the HttpOnly session", async () => {
    avatarBridge.uploadMemberAvatar.mockResolvedValue(member);
    const form = new FormData();
    form.set(
      "avatar",
      new File([Buffer.from([137, 80, 78, 71])], "avatar.png", { type: "image/png" }),
    );
    const response = await PUT(
      new NextRequest("https://whichone.site/api/me/avatar", {
        method: "PUT",
        headers: {
          cookie: "which_member_session=member-token",
          "x-which-csrf": "member-avatar",
        },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ member });
    expect(avatarBridge.uploadMemberAvatar).toHaveBeenCalledWith(
      "member-token",
      expect.any(Buffer),
    );
  });

  it("rejects unsupported upload types before image processing", async () => {
    const form = new FormData();
    form.set("avatar", new File(["svg"], "avatar.svg", { type: "image/svg+xml" }));
    const response = await PUT(
      new NextRequest("https://whichone.site/api/me/avatar", {
        method: "PUT",
        headers: {
          cookie: "which_member_session=member-token",
          "x-which-csrf": "member-avatar",
        },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(avatarBridge.uploadMemberAvatar).not.toHaveBeenCalled();
  });

  it("removes the stored image through the authenticated bridge", async () => {
    avatarBridge.removeMemberAvatar.mockResolvedValue({
      ...member,
      avatar: { kind: "INITIALS" as const, initials: "프로" },
    });
    const response = await DELETE(
      new NextRequest("https://whichone.site/api/me/avatar", {
        method: "DELETE",
        headers: {
          cookie: "which_member_session=member-token",
          "x-which-csrf": "member-avatar",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(avatarBridge.removeMemberAvatar).toHaveBeenCalledWith("member-token");
  });
});

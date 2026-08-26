import { describe, expect, it, vi } from "vitest";

import { authenticateInSystemBrowser } from "./native-auth-browser";

const { openAuthSessionAsync } = vi.hoisted(() => ({ openAuthSessionAsync: vi.fn() }));

vi.mock("expo-web-browser", () => ({ openAuthSessionAsync }));

describe("Native system-browser authentication", () => {
  it("completes only a successful fixed-scheme return", async () => {
    openAuthSessionAsync.mockResolvedValueOnce({
      type: "success",
      url: "which://auth/callback?ticket=t",
    });
    const session = { token: "token" };
    const manager = {
      begin: vi.fn(async () => "https://whichone.site/api/mobile-auth/start"),
      complete: vi.fn(async () => session),
      cancel: vi.fn(async () => undefined),
    };

    await expect(
      authenticateInSystemBrowser(
        manager as never,
        "google",
        "591f2e90-996a-50c5-af46-967dd0793000",
      ),
    ).resolves.toBe(session);
    expect(manager.begin).toHaveBeenCalledWith("google", "591f2e90-996a-50c5-af46-967dd0793000");
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      "https://whichone.site/api/mobile-auth/start",
      "which://auth/callback",
    );
    expect(manager.complete).toHaveBeenCalledWith("which://auth/callback?ticket=t");
  });

  it("clears pending proof when the user closes the browser", async () => {
    openAuthSessionAsync.mockResolvedValueOnce({ type: "cancel" });
    const manager = {
      begin: vi.fn(async () => "https://whichone.site/api/mobile-auth/start"),
      complete: vi.fn(),
      cancel: vi.fn(async () => undefined),
    };

    await expect(authenticateInSystemBrowser(manager as never, "x")).resolves.toBeNull();
    expect(manager.cancel).toHaveBeenCalledOnce();
    expect(manager.complete).not.toHaveBeenCalled();
  });
});

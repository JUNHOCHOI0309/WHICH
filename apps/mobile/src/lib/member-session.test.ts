import { describe, expect, it, vi } from "vitest";

import type { SubjectStorage } from "./guest-subject";
import { createMemberSessionManager, MEMBER_SESSION_STORAGE_KEY } from "./member-session";
import { MobileApiError, type MobileApiClient } from "./mobile-api";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: SubjectStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => void values.set(key, value)),
    removeItem: vi.fn(async (key) => void values.delete(key)),
  };
  return { storage, values };
}

const member = {
  id: "591f2e90-996a-50c5-af46-967dd0793000",
  displayName: "Native Member",
  status: "ACTIVE" as const,
  avatar: { kind: "INITIALS" as const, initials: "NM" },
};

describe("Native Member session manager", () => {
  it("restores a valid SecureStore session and clears an invalid one", async () => {
    const { storage, values } = memoryStorage();
    values.set(
      MEMBER_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        token: "t".repeat(43),
        expiresAt: "2026-09-01T00:00:00.000Z",
        member,
      }),
    );
    const api = {
      loadMemberSession: vi.fn(async () => ({
        expiresAt: "2026-09-02T00:00:00.000Z",
        member,
      })),
    } as unknown as MobileApiClient;
    const manager = createMemberSessionManager(storage, api);

    await expect(manager.restore()).resolves.toMatchObject({ token: "t".repeat(43), member });
    expect(api.loadMemberSession).toHaveBeenCalledWith("t".repeat(43));

    vi.mocked(api.loadMemberSession).mockRejectedValueOnce(
      new MobileApiError("SESSION_INVALID", 401, "expired"),
    );
    await expect(manager.restore()).resolves.toBeNull();
    expect(values.has(MEMBER_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("rotates the stored token and always clears it during logout", async () => {
    const { storage, values } = memoryStorage();
    const api = {
      refreshMemberSession: vi.fn(async () => ({
        token: "r".repeat(43),
        expiresAt: "2026-09-03T00:00:00.000Z",
        member,
      })),
      revokeMemberSession: vi.fn(async () => undefined),
    } as unknown as MobileApiClient;
    const manager = createMemberSessionManager(storage, api);
    await manager.save({
      token: "t".repeat(43),
      expiresAt: "2026-09-01T00:00:00.000Z",
      member,
    });

    await expect(manager.refresh()).resolves.toMatchObject({ token: "r".repeat(43) });
    await manager.logout();
    expect(api.revokeMemberSession).toHaveBeenCalledWith("r".repeat(43));
    expect(values.has(MEMBER_SESSION_STORAGE_KEY)).toBe(false);
  });
});

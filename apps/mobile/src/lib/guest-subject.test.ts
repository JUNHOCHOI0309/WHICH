import { describe, expect, it, vi } from "vitest";

import { createGuestSubjectManager, type SubjectStorage } from "./guest-subject";
import type { MobileApiClient } from "./mobile-api";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  const storage: SubjectStorage = {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async (_key, next) => {
      value = next;
    }),
    removeItem: vi.fn(async () => {
      value = null;
    }),
  };
  return storage;
}

describe("Guest Subject manager", () => {
  it("reuses a valid stored subject", async () => {
    const stored = "591f2e90-996a-50c5-af46-967dd0793000";
    const storage = memoryStorage(stored);
    const api = { createGuestSubject: vi.fn() } as unknown as MobileApiClient;

    await expect(createGuestSubjectManager(storage, api).getOrCreate()).resolves.toBe(stored);
    expect(api.createGuestSubject).not.toHaveBeenCalled();
  });

  it("replaces an invalid or missing subject", async () => {
    const created = "8c092a45-c446-50f3-b1ac-ac9a018b9105";
    const storage = memoryStorage("invalid");
    const api = {
      createGuestSubject: vi.fn(async () => ({ anonymousSubjectId: created })),
    } as unknown as MobileApiClient;

    await expect(createGuestSubjectManager(storage, api).getOrCreate()).resolves.toBe(created);
    expect(storage.setItem).toHaveBeenCalledWith(expect.any(String), created);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { MemberSessionView } from "@/contracts";

import type { SubjectStorage } from "./guest-subject";
import {
  createGuestMemberContinuityManager,
  PENDING_GUEST_MEMBER_MERGE_KEY,
} from "./guest-member-continuity";
import type { MobileApiClient } from "./mobile-api";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: SubjectStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => void values.set(key, value)),
    removeItem: vi.fn(async (key) => void values.delete(key)),
  };
  return { storage, values };
}

const session: MemberSessionView = {
  token: "m".repeat(43),
  expiresAt: "2026-09-01T00:00:00.000Z",
  member: {
    id: "591f2e90-996a-50c5-af46-967dd0793000",
    displayName: "Native Member",
    status: "ACTIVE",
    avatar: { kind: "INITIALS", initials: "NM" },
  },
};

const anonymousSubjectId = "93831fba-b70f-598a-88f6-92eb4f70df9c";

describe("Guest to Member continuity", () => {
  it("merges suggested Guest interests once and clears the retry marker", async () => {
    const { storage, values } = memoryStorage();
    const api = {
      loadInterestProfile: vi.fn(async () => ({
        selectedCardCodes: ["FOOD"],
        mergeCandidate: {
          anonymousSubjectId,
          guestCardCodes: ["GAME", "TECH"],
          suggestedCardCodes: ["GAME", "TECH"],
        },
      })),
      mergeGuestInterestProfile: vi.fn(async () => ({
        selectedCardCodes: ["FOOD", "GAME", "TECH"],
      })),
    } as unknown as MobileApiClient;
    const manager = createGuestMemberContinuityManager(storage, api);

    await manager.schedule(session, anonymousSubjectId);
    await manager.retry(session);

    expect(api.mergeGuestInterestProfile).toHaveBeenCalledOnce();
    expect(api.mergeGuestInterestProfile).toHaveBeenCalledWith({
      sessionToken: session.token,
      anonymousSubjectId,
      selectedCardCodes: ["GAME", "TECH"],
    });
    expect(values.has(PENDING_GUEST_MEMBER_MERGE_KEY)).toBe(false);
  });

  it("keeps the retry marker when a merge fails, then completes safely", async () => {
    const { storage, values } = memoryStorage();
    const api = {
      loadInterestProfile: vi.fn(async () => ({
        selectedCardCodes: [],
        mergeCandidate: {
          anonymousSubjectId,
          guestCardCodes: ["FOOD"],
          suggestedCardCodes: ["FOOD"],
        },
      })),
      mergeGuestInterestProfile: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce({ selectedCardCodes: ["FOOD"] }),
    } as unknown as MobileApiClient;
    const manager = createGuestMemberContinuityManager(storage, api);

    await expect(manager.schedule(session, anonymousSubjectId)).rejects.toThrow("temporary");
    expect(values.has(PENDING_GUEST_MEMBER_MERGE_KEY)).toBe(true);

    await expect(manager.retry(session)).resolves.toBeUndefined();
    expect(api.mergeGuestInterestProfile).toHaveBeenCalledTimes(2);
    expect(values.has(PENDING_GUEST_MEMBER_MERGE_KEY)).toBe(false);
  });
});

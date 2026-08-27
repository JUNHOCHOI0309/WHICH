import { describe, expect, it, vi } from "vitest";

import type { SubjectStorage } from "./guest-subject";
import { MEMBER_SESSION_STORAGE_KEY } from "./member-session";
import type { MobileApiClient } from "./mobile-api";
import {
  createNativeAuthManager,
  LAST_NATIVE_AUTH_PROVIDER_STORAGE_KEY,
  PENDING_NATIVE_AUTH_STORAGE_KEY,
} from "./native-auth";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
  getRandomBytesAsync: vi.fn(),
  digestStringAsync: vi.fn(),
}));

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: SubjectStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => void values.set(key, value)),
    removeItem: vi.fn(async (key) => void values.delete(key)),
  };
  return { storage, values };
}

const crypto = {
  randomBytes: vi.fn(async (count: number) => new Uint8Array(count).fill(count)),
  sha256Base64: vi.fn(async () => `${"A".repeat(43)}=`),
};

describe("Native authentication request", () => {
  it("creates PKCE proof and accepts only the matching fixed callback", async () => {
    const { storage, values } = memoryStorage();
    const session = {
      token: "m".repeat(43),
      expiresAt: "2026-09-01T00:00:00.000Z",
      member: {
        id: "591f2e90-996a-50c5-af46-967dd0793000",
        displayName: "Native Member",
        status: "ACTIVE" as const,
        avatar: { kind: "INITIALS" as const, initials: "NM" },
      },
    };
    const api = {
      exchangeMobileSession: vi.fn(async () => session),
      loadInterestProfile: vi.fn(async () => ({
        taxonomyVersion: "interest_cards_v1",
        onboardingState: "NOT_STARTED",
        selectedCardCodes: [],
        canSkip: true,
        profileVersion: 1,
        mergeCandidate: null,
      })),
    } as unknown as MobileApiClient;
    const manager = createNativeAuthManager(storage, api, {
      crypto,
      now: () => 1_000,
      webBaseUrl: "https://whichone.site",
    });

    const anonymousSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";
    const returnTo = "/issues/93831fba-b70f-598a-88f6-92eb4f70df9c";
    const startUrl = new URL(await manager.begin("kakao", anonymousSubjectId, returnTo));
    expect(startUrl.pathname).toBe("/api/mobile-auth/start");
    expect(startUrl.searchParams.get("code_challenge")).toBe("A".repeat(43));
    expect(startUrl.searchParams.get("provider")).toBe("kakao");
    const pending = JSON.parse(values.get(PENDING_NATIVE_AUTH_STORAGE_KEY)!) as {
      state: string;
      nonce: string;
    };

    await expect(
      manager.complete(
        `which://auth/callback?state=wrong&nonce=${pending.nonce}&ticket=${"t".repeat(43)}`,
      ),
    ).rejects.toThrow("NATIVE_AUTH_CALLBACK_INVALID");
    expect(api.exchangeMobileSession).not.toHaveBeenCalled();

    await expect(
      manager.complete(
        `which://auth/callback?state=${pending.state}&nonce=${pending.nonce}&ticket=${"t".repeat(43)}`,
      ),
    ).resolves.toEqual({ session, returnTo });
    expect(api.exchangeMobileSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: "t".repeat(43),
        state: pending.state,
        nonce: pending.nonce,
        anonymousSubjectId,
      }),
    );
    expect(values.has(PENDING_NATIVE_AUTH_STORAGE_KEY)).toBe(false);
    expect(values.has(MEMBER_SESSION_STORAGE_KEY)).toBe(true);
    expect(values.get(LAST_NATIVE_AUTH_PROVIDER_STORAGE_KEY)).toBe("kakao");
    await expect(manager.lastProvider()).resolves.toBe("kakao");
  });

  it("ignores an external return target instead of creating an open redirect", async () => {
    const { storage, values } = memoryStorage();
    const manager = createNativeAuthManager(storage, {} as MobileApiClient, {
      crypto,
      now: () => 1_000,
      webBaseUrl: "https://whichone.site",
    });

    await manager.begin("google", undefined, "https://evil.example/steal");

    const pending = JSON.parse(values.get(PENDING_NATIVE_AUTH_STORAGE_KEY)!) as {
      returnTo?: string;
    };
    expect(pending.returnTo).toBeUndefined();
  });

  it("clears a matching Provider cancellation so the user can retry", async () => {
    const { storage, values } = memoryStorage();
    const api = { exchangeMobileSession: vi.fn() } as unknown as MobileApiClient;
    const manager = createNativeAuthManager(storage, api, {
      crypto,
      now: () => 1_000,
      webBaseUrl: "https://whichone.site",
    });
    await manager.begin("google");
    const pending = JSON.parse(values.get(PENDING_NATIVE_AUTH_STORAGE_KEY)!) as {
      state: string;
      nonce: string;
    };

    await expect(
      manager.complete(
        `which://auth/callback?state=${pending.state}&nonce=${pending.nonce}&error=provider_cancelled`,
      ),
    ).rejects.toThrow("provider_cancelled");
    expect(values.has(PENDING_NATIVE_AUTH_STORAGE_KEY)).toBe(false);
  });
});

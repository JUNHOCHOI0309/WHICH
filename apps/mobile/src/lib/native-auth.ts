import * as Crypto from "expo-crypto";

import type { SubjectStorage } from "./guest-subject";
import { createGuestMemberContinuityManager } from "./guest-member-continuity";
import { createMemberSessionManager } from "./member-session";
import type { MobileApiClient } from "./mobile-api";

export const PENDING_NATIVE_AUTH_STORAGE_KEY = "which.mobile.pending-auth.v1";
export const LAST_NATIVE_AUTH_PROVIDER_STORAGE_KEY = "which.mobile.last-auth-provider.v1";

export type NativeAuthProvider = "email" | "google" | "x" | "naver" | "kakao";
export type NativeAuthReturnTo = "/" | "/me" | `/issues/${string}`;

type PendingNativeAuth = {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  provider: NativeAuthProvider;
  anonymousSubjectId?: string;
  returnTo?: NativeAuthReturnTo;
  createdAt: number;
};

const providers: NativeAuthProvider[] = ["email", "google", "x", "naver", "kakao"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validNativeAuthReturnTo(value: string | undefined): NativeAuthReturnTo | undefined {
  if (value === "/" || value === "/me") return value;
  if (value?.startsWith("/issues/") && uuidPattern.test(value.slice("/issues/".length))) {
    return value as NativeAuthReturnTo;
  }
  return undefined;
}

type NativeAuthCrypto = {
  randomBytes(count: number): Promise<Uint8Array>;
  sha256Base64(value: string): Promise<string>;
};

const defaultCrypto: NativeAuthCrypto = {
  randomBytes: Crypto.getRandomBytesAsync,
  sha256Base64: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
};

function base64Url(value: string) {
  return value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomProof(bytes: Uint8Array) {
  return base64Url(bytesToBase64(bytes));
}

function parsePending(value: string | null, now: number) {
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as Partial<PendingNativeAuth>;
    if (
      pending.version !== 1 ||
      typeof pending.state !== "string" ||
      typeof pending.nonce !== "string" ||
      typeof pending.codeVerifier !== "string" ||
      typeof pending.provider !== "string" ||
      !providers.includes(pending.provider as NativeAuthProvider) ||
      (pending.anonymousSubjectId !== undefined &&
        (typeof pending.anonymousSubjectId !== "string" ||
          !uuidPattern.test(pending.anonymousSubjectId))) ||
      (pending.returnTo !== undefined &&
        (typeof pending.returnTo !== "string" || !validNativeAuthReturnTo(pending.returnTo))) ||
      typeof pending.createdAt !== "number" ||
      pending.createdAt > now + 30_000 ||
      now - pending.createdAt > 10 * 60 * 1_000
    ) {
      return null;
    }
    return pending as PendingNativeAuth;
  } catch {
    return null;
  }
}

export function createNativeAuthManager(
  storage: SubjectStorage,
  api: MobileApiClient,
  options: { crypto?: NativeAuthCrypto; now?: () => number; webBaseUrl?: string } = {},
) {
  const crypto = options.crypto ?? defaultCrypto;
  const now = options.now ?? Date.now;
  const webBaseUrl = options.webBaseUrl ?? "https://whichone.site";
  const sessions = createMemberSessionManager(storage, api);
  const continuity = createGuestMemberContinuityManager(storage, api);

  return {
    async begin(
      provider: NativeAuthProvider = "email",
      anonymousSubjectId?: string,
      returnTo?: string,
    ) {
      const [stateBytes, nonceBytes, verifierBytes] = await Promise.all([
        crypto.randomBytes(32),
        crypto.randomBytes(32),
        crypto.randomBytes(48),
      ]);
      const pending: PendingNativeAuth = {
        version: 1,
        state: randomProof(stateBytes),
        nonce: randomProof(nonceBytes),
        codeVerifier: randomProof(verifierBytes),
        provider,
        ...(anonymousSubjectId ? { anonymousSubjectId } : {}),
        ...(validNativeAuthReturnTo(returnTo)
          ? { returnTo: validNativeAuthReturnTo(returnTo) }
          : {}),
        createdAt: now(),
      };
      const codeChallenge = base64Url(await crypto.sha256Base64(pending.codeVerifier));
      await storage.setItem(PENDING_NATIVE_AUTH_STORAGE_KEY, JSON.stringify(pending));
      const target = new URL("/api/mobile-auth/start", webBaseUrl);
      target.searchParams.set("state", pending.state);
      target.searchParams.set("nonce", pending.nonce);
      target.searchParams.set("code_challenge", codeChallenge);
      target.searchParams.set("provider", provider);
      return target.toString();
    },

    async lastProvider() {
      const provider = await storage.getItem(LAST_NATIVE_AUTH_PROVIDER_STORAGE_KEY);
      return providers.includes(provider as NativeAuthProvider)
        ? (provider as NativeAuthProvider)
        : null;
    },

    async cancel() {
      await storage.removeItem(PENDING_NATIVE_AUTH_STORAGE_KEY);
    },

    async complete(callbackUrl: string) {
      const pending = parsePending(await storage.getItem(PENDING_NATIVE_AUTH_STORAGE_KEY), now());
      if (!pending) {
        await storage.removeItem(PENDING_NATIVE_AUTH_STORAGE_KEY);
        throw new Error("NATIVE_AUTH_REQUEST_EXPIRED");
      }

      const callback = new URL(callbackUrl);
      const state = callback.searchParams.get("state");
      const nonce = callback.searchParams.get("nonce");
      const ticket = callback.searchParams.get("ticket");
      const error = callback.searchParams.get("error");
      const callbackMatches =
        callback.protocol !== "which:" ||
        callback.host !== "auth" ||
        callback.pathname !== "/callback" ||
        state !== pending.state ||
        nonce !== pending.nonce;
      if (callbackMatches) {
        throw new Error("NATIVE_AUTH_CALLBACK_INVALID");
      }
      if (error || !ticket) {
        await storage.removeItem(PENDING_NATIVE_AUTH_STORAGE_KEY);
        throw new Error(error || "NATIVE_AUTH_CALLBACK_INVALID");
      }

      try {
        const session = await api.exchangeMobileSession({
          ticket,
          codeVerifier: pending.codeVerifier,
          state: pending.state,
          nonce: pending.nonce,
          anonymousSubjectId: pending.anonymousSubjectId,
        });
        await sessions.save(session);
        if (pending.anonymousSubjectId) {
          await continuity.schedule(session, pending.anonymousSubjectId).catch(() => undefined);
        }
        await storage.setItem(LAST_NATIVE_AUTH_PROVIDER_STORAGE_KEY, pending.provider);
        return { session, returnTo: pending.returnTo };
      } finally {
        await storage.removeItem(PENDING_NATIVE_AUTH_STORAGE_KEY);
      }
    },
  };
}

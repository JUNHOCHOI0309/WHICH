import type { MemberSessionView } from "@/contracts";

import type { SubjectStorage } from "./guest-subject";
import { MobileApiError, type MobileApiClient } from "./mobile-api";

export const MEMBER_SESSION_STORAGE_KEY = "which.mobile.member-session.v1";

type StoredMemberSession = MemberSessionView & { version: 1 };

function parseStoredSession(value: string | null): StoredMemberSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<StoredMemberSession>;
    if (
      session.version !== 1 ||
      typeof session.token !== "string" ||
      session.token.length < 32 ||
      typeof session.expiresAt !== "string" ||
      !session.member ||
      typeof session.member.id !== "string" ||
      typeof session.member.displayName !== "string"
    ) {
      return null;
    }
    return session as StoredMemberSession;
  } catch {
    return null;
  }
}

export function createMemberSessionManager(storage: SubjectStorage, api: MobileApiClient) {
  async function save(session: MemberSessionView) {
    await storage.setItem(
      MEMBER_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, ...session } satisfies StoredMemberSession),
    );
    return session;
  }

  return {
    save,

    async restore() {
      const stored = parseStoredSession(await storage.getItem(MEMBER_SESSION_STORAGE_KEY));
      if (!stored) {
        await storage.removeItem(MEMBER_SESSION_STORAGE_KEY);
        return null;
      }
      try {
        const current = await api.loadMemberSession(stored.token);
        return save({ token: stored.token, ...current });
      } catch (error) {
        if (error instanceof MobileApiError && error.status === 401) {
          await storage.removeItem(MEMBER_SESSION_STORAGE_KEY);
          return null;
        }
        throw error;
      }
    },

    async refresh() {
      const stored = parseStoredSession(await storage.getItem(MEMBER_SESSION_STORAGE_KEY));
      if (!stored) return null;
      try {
        return await save(await api.refreshMemberSession(stored.token));
      } catch (error) {
        if (error instanceof MobileApiError && error.status === 401) {
          await storage.removeItem(MEMBER_SESSION_STORAGE_KEY);
          return null;
        }
        throw error;
      }
    },

    async logout() {
      const stored = parseStoredSession(await storage.getItem(MEMBER_SESSION_STORAGE_KEY));
      try {
        if (stored) await api.revokeMemberSession(stored.token);
      } finally {
        await storage.removeItem(MEMBER_SESSION_STORAGE_KEY);
      }
    },
  };
}

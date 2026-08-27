import type { MemberSessionView } from "@/contracts";

import { validGuestSubject, type SubjectStorage } from "./guest-subject";
import type { MobileApiClient } from "./mobile-api";

export const PENDING_GUEST_MEMBER_MERGE_KEY = "which.mobile.guest-member-merge.v1";

type PendingMerge = {
  version: 1;
  anonymousSubjectId: string;
  memberId: string;
};

function parsePending(value: string | null): PendingMerge | null {
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as Partial<PendingMerge>;
    if (
      pending.version !== 1 ||
      !validGuestSubject(pending.anonymousSubjectId) ||
      !validGuestSubject(pending.memberId)
    ) {
      return null;
    }
    return pending as PendingMerge;
  } catch {
    return null;
  }
}

export function createGuestMemberContinuityManager(storage: SubjectStorage, api: MobileApiClient) {
  async function retry(session: MemberSessionView) {
    const pending = parsePending(await storage.getItem(PENDING_GUEST_MEMBER_MERGE_KEY));
    if (!pending) {
      await storage.removeItem(PENDING_GUEST_MEMBER_MERGE_KEY);
      return;
    }
    if (pending.memberId !== session.member.id) return;

    const profile = await api.loadInterestProfile(pending.anonymousSubjectId, session.token);
    const suggested = profile.mergeCandidate?.suggestedCardCodes ?? [];
    const freeSlots = Math.max(0, 8 - profile.selectedCardCodes.length);
    const selectedCardCodes = suggested.slice(0, freeSlots);
    if (selectedCardCodes.length > 0) {
      await api.mergeGuestInterestProfile({
        sessionToken: session.token,
        anonymousSubjectId: pending.anonymousSubjectId,
        selectedCardCodes,
      });
    }
    await storage.removeItem(PENDING_GUEST_MEMBER_MERGE_KEY);
  }

  return {
    async schedule(session: MemberSessionView, anonymousSubjectId: string) {
      const validated = validGuestSubject(anonymousSubjectId);
      if (!validated) return;
      await storage.setItem(
        PENDING_GUEST_MEMBER_MERGE_KEY,
        JSON.stringify({
          version: 1,
          anonymousSubjectId: validated,
          memberId: session.member.id,
        } satisfies PendingMerge),
      );
      await retry(session);
    },
    retry,
  };
}

import { createHash } from "node:crypto";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  interestProfiles,
  memberSessions,
  recommendationItems,
  recommendationRequests,
  subjectInterests,
  voterSubjects,
} from "../../database/schema/index.js";
import type { InterestCardCode } from "../interests/contracts.js";
import {
  RANKING_VERSION,
  type FeedRankingContext,
  type RankedIssue,
  type RankingProfile,
} from "./contracts.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function loadRankingProfile(
  database: Database["db"],
  context: { anonymousSubjectId?: string; sessionToken?: string; enabled: boolean },
): Promise<RankingProfile> {
  let subject: { id: string } | undefined;

  if (context.sessionToken) {
    [subject] = await database
      .select({ id: voterSubjects.id })
      .from(memberSessions)
      .innerJoin(voterSubjects, eq(voterSubjects.userId, memberSessions.memberId))
      .where(
        and(
          eq(memberSessions.tokenHash, hashToken(context.sessionToken)),
          isNull(memberSessions.revokedAt),
          gt(memberSessions.expiresAt, new Date()),
          inArray(voterSubjects.kind, ["MEMBER", "VERIFIED_MEMBER"]),
        ),
      )
      .limit(1);
  }

  if (!subject && context.anonymousSubjectId) {
    [subject] = await database
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(
        and(
          eq(voterSubjects.kind, "GUEST"),
          eq(voterSubjects.anonymousSubjectId, context.anonymousSubjectId),
        ),
      )
      .limit(1);
  }

  if (!subject) {
    return {
      subjectId: null,
      profileVersion: null,
      selectedCardCodes: [],
      mode: "RECENCY",
      reasonCode: "IDENTITY_UNAVAILABLE",
    };
  }

  if (!context.enabled) {
    return {
      subjectId: subject.id,
      profileVersion: null,
      selectedCardCodes: [],
      mode: "RECENCY",
      reasonCode: "FEATURE_DISABLED",
    };
  }

  const [profile] = await database
    .select({
      onboardingState: interestProfiles.onboardingState,
      version: interestProfiles.profileVersion,
    })
    .from(interestProfiles)
    .where(eq(interestProfiles.subjectId, subject.id))
    .limit(1);

  if (!profile || profile.onboardingState !== "COMPLETED") {
    return {
      subjectId: subject.id,
      profileVersion: profile?.version ?? null,
      selectedCardCodes: [],
      mode: "RECENCY",
      reasonCode: "PROFILE_NOT_READY",
    };
  }

  const selections = await database
    .select({ cardCode: subjectInterests.cardCode })
    .from(subjectInterests)
    .where(eq(subjectInterests.subjectId, subject.id));
  if (selections.length === 0) {
    return {
      subjectId: subject.id,
      profileVersion: profile.version,
      selectedCardCodes: [],
      mode: "RECENCY",
      reasonCode: "PROFILE_NOT_READY",
    };
  }

  return {
    subjectId: subject.id,
    profileVersion: profile.version,
    selectedCardCodes: selections.map((item) => item.cardCode as InterestCardCode).sort(),
    mode: "PERSONALIZED",
    reasonCode: "INTEREST_PROFILE_MATCH",
  };
}

export async function recordRecommendation(
  database: Database["db"],
  ranking: FeedRankingContext,
  subjectId: string | null,
  items: RankedIssue[],
) {
  await database.transaction(async (transaction) => {
    await transaction.insert(recommendationRequests).values({
      id: ranking.requestId,
      subjectId,
      rankingVersion: RANKING_VERSION,
      rankingMode: ranking.mode,
      reasonCode: ranking.reasonCode,
      profileVersion: ranking.profileVersion,
    });
    if (items.length > 0) {
      await transaction.insert(recommendationItems).values(
        items.map((item, index) => ({
          requestId: ranking.requestId,
          position: index + 1,
          issueId: item.id,
          issueVersion: item.version,
          score: item.score,
          reasonCodes: item.reasonCodes,
          matchedCardCodes: item.matchedCardCodes,
        })),
      );
    }
  });
}

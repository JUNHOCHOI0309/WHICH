import { createHash, randomUUID } from "node:crypto";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  guestMemberLinks,
  interestProfiles,
  memberSessions,
  outboxEvents,
  subjectInterests,
  voterSubjects,
} from "../../database/schema/index.js";
import {
  INTEREST_CARD_CODES,
  INTEREST_TAXONOMY_VERSION,
  type InterestCard,
  type InterestCardCode,
  type InterestProfileService,
  type InterestProfileView,
  type InterestSubjectContext,
} from "./contracts.js";
import { InterestProfileError } from "./errors.js";

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 8;

const INTEREST_CARDS: InterestCard[] = [
  {
    code: "DAILY_LIFE",
    label: "생활",
    categoryCodes: ["LIFE"],
    topicCodes: ["HOUSING", "TRANSPORT", "DAILY_MANNER", "PET"],
  },
  {
    code: "FOOD",
    label: "음식",
    categoryCodes: ["LIFE"],
    topicCodes: ["FOOD", "DINING", "COOKING", "CAFE"],
  },
  {
    code: "TRAVEL",
    label: "여행",
    categoryCodes: ["LIFE"],
    topicCodes: ["TRAVEL", "TRIP_STYLE", "DOMESTIC", "OVERSEAS"],
  },
  {
    code: "RELATIONSHIP",
    label: "연애·관계",
    categoryCodes: ["RELATIONSHIP"],
    topicCodes: ["DATING", "MARRIAGE", "FRIEND", "FAMILY"],
  },
  {
    code: "WORK",
    label: "직장",
    categoryCodes: ["WORK_CAREER"],
    topicCodes: ["WORKPLACE", "REMOTE", "JOB", "CAREER"],
  },
  {
    code: "ECONOMY_CONSUMPTION",
    label: "경제·소비",
    categoryCodes: ["ECONOMY_CONSUMPTION"],
    topicCodes: ["PRICE", "SHOPPING", "FINANCE", "INFLATION"],
  },
  {
    code: "TECH",
    label: "IT·테크",
    categoryCodes: ["TECH"],
    topicCodes: ["AI", "SMARTPHONE", "PLATFORM", "DEVELOPMENT"],
  },
  {
    code: "GAME",
    label: "게임",
    categoryCodes: ["CULTURE_ENT"],
    topicCodes: ["GAME", "ESPORTS", "CONSOLE", "MOBILE"],
  },
  {
    code: "MOVIE_DRAMA",
    label: "영화·드라마",
    categoryCodes: ["CULTURE_ENT"],
    topicCodes: ["MOVIE", "DRAMA", "OTT"],
  },
  {
    code: "MUSIC_CONTENT",
    label: "음악·콘텐츠",
    categoryCodes: ["CULTURE_ENT"],
    topicCodes: ["MUSIC", "CREATOR", "WEBTOON", "BROADCAST"],
  },
  {
    code: "SPORTS",
    label: "스포츠",
    categoryCodes: ["SPORTS"],
    topicCodes: ["MATCH", "PLAYER", "FAN_CULTURE"],
  },
  {
    code: "EDUCATION",
    label: "교육",
    categoryCodes: ["EDUCATION"],
    topicCodes: ["SCHOOL", "COLLEGE", "STUDY", "EDUCATION_CULTURE"],
  },
  {
    code: "SOCIETY",
    label: "사회",
    categoryCodes: ["SOCIETY"],
    topicCodes: ["PUBLIC_MANNER", "GENERATION", "WELFARE", "ENVIRONMENT"],
  },
  {
    code: "HOBBY",
    label: "취미",
    categoryCodes: ["LIFE", "CULTURE_ENT"],
    topicCodes: ["HOBBY", "READING", "FITNESS", "COLLECTION"],
  },
];

const validCardCodes = new Set<string>(INTEREST_CARD_CODES);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizedCodes(codes: InterestCardCode[]) {
  return [...new Set(codes)].sort();
}

function validateCompletedSelection(codes: InterestCardCode[]) {
  const normalized = normalizedCodes(codes);
  if (
    normalized.length < MIN_INTERESTS ||
    normalized.length > MAX_INTERESTS ||
    normalized.some((code) => !validCardCodes.has(code))
  ) {
    throw new InterestProfileError(
      "INVALID_INTEREST_SELECTION",
      422,
      `Choose between ${MIN_INTERESTS} and ${MAX_INTERESTS} valid interest cards.`,
    );
  }
  return normalized;
}

export function createInterestProfileService(database: Database["db"]): InterestProfileService {
  async function resolveSubject(context: InterestSubjectContext) {
    if (context.sessionToken) {
      const now = new Date();
      const [subject] = await database
        .select({ id: voterSubjects.id, kind: voterSubjects.kind, userId: voterSubjects.userId })
        .from(memberSessions)
        .innerJoin(voterSubjects, eq(voterSubjects.userId, memberSessions.memberId))
        .where(
          and(
            eq(memberSessions.tokenHash, hashToken(context.sessionToken)),
            isNull(memberSessions.revokedAt),
            gt(memberSessions.expiresAt, now),
            inArray(voterSubjects.kind, ["MEMBER", "VERIFIED_MEMBER"]),
          ),
        )
        .limit(1);
      if (!subject) {
        throw new InterestProfileError("SESSION_INVALID", 401, "The Member session is invalid.");
      }
      return subject;
    }

    if (!context.anonymousSubjectId) {
      throw new InterestProfileError(
        "SUBJECT_REQUIRED",
        400,
        "A Guest subject or Member session is required.",
      );
    }

    const [subject] = await database
      .select({ id: voterSubjects.id, kind: voterSubjects.kind, userId: voterSubjects.userId })
      .from(voterSubjects)
      .where(
        and(
          eq(voterSubjects.kind, "GUEST"),
          eq(voterSubjects.anonymousSubjectId, context.anonymousSubjectId),
        ),
      )
      .limit(1);
    if (!subject) {
      throw new InterestProfileError(
        "GUEST_SUBJECT_NOT_FOUND",
        404,
        "The Guest subject does not exist.",
      );
    }
    return subject;
  }

  async function readView(
    subject: Awaited<ReturnType<typeof resolveSubject>>,
    context: InterestSubjectContext,
  ): Promise<InterestProfileView> {
    const [profile] = await database
      .select()
      .from(interestProfiles)
      .where(eq(interestProfiles.subjectId, subject.id))
      .limit(1);
    const selections = profile
      ? await database
          .select({ cardCode: subjectInterests.cardCode })
          .from(subjectInterests)
          .where(eq(subjectInterests.subjectId, subject.id))
          .orderBy(subjectInterests.cardCode)
      : [];
    const selectedCardCodes = selections.map((item) => item.cardCode as InterestCardCode);

    let mergeCandidate: InterestProfileView["mergeCandidate"] = null;
    if (subject.kind !== "GUEST" && context.anonymousSubjectId) {
      const [guest] = await database
        .select({ id: voterSubjects.id, anonymousSubjectId: voterSubjects.anonymousSubjectId })
        .from(voterSubjects)
        .innerJoin(
          guestMemberLinks,
          and(
            eq(guestMemberLinks.guestSubjectId, voterSubjects.id),
            eq(guestMemberLinks.memberSubjectId, subject.id),
          ),
        )
        .where(eq(voterSubjects.anonymousSubjectId, context.anonymousSubjectId))
        .limit(1);
      if (guest?.anonymousSubjectId) {
        const guestSelections = await database
          .select({ cardCode: subjectInterests.cardCode })
          .from(subjectInterests)
          .where(eq(subjectInterests.subjectId, guest.id))
          .orderBy(subjectInterests.cardCode);
        const guestCardCodes = guestSelections.map((item) => item.cardCode as InterestCardCode);
        const selectedSet = new Set(selectedCardCodes);
        const suggestedCardCodes = guestCardCodes.filter((code) => !selectedSet.has(code));
        if (suggestedCardCodes.length > 0) {
          mergeCandidate = {
            anonymousSubjectId: guest.anonymousSubjectId,
            guestCardCodes,
            suggestedCardCodes,
          };
        }
      }
    }

    return {
      taxonomyVersion: INTEREST_TAXONOMY_VERSION,
      onboardingState: (profile?.onboardingState ??
        "NOT_STARTED") as InterestProfileView["onboardingState"],
      selectedCardCodes,
      canSkip: subject.kind === "GUEST",
      profileVersion: profile?.profileVersion ?? 1,
      mergeCandidate,
    };
  }

  async function replaceSelections(
    subject: { id: string; userId: string | null },
    codes: InterestCardCode[],
    state: "COMPLETED" | "SKIPPED",
  ) {
    const subjectId = subject.id;
    const now = new Date();
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${subjectId}, 0))`,
      );
      await transaction
        .insert(interestProfiles)
        .values({
          subjectId,
          onboardingState: state,
          taxonomyVersion: INTEREST_TAXONOMY_VERSION,
          completedAt: state === "COMPLETED" ? now : null,
          skippedAt: state === "SKIPPED" ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: interestProfiles.subjectId,
          set: {
            onboardingState: state,
            taxonomyVersion: INTEREST_TAXONOMY_VERSION,
            profileVersion: sql`${interestProfiles.profileVersion} + 1`,
            completedAt: state === "COMPLETED" ? now : null,
            skippedAt: state === "SKIPPED" ? now : null,
            resetAt: null,
            updatedAt: now,
          },
        });
      await transaction.delete(subjectInterests).where(eq(subjectInterests.subjectId, subjectId));
      if (codes.length > 0) {
        await transaction.insert(subjectInterests).values(
          codes.map((cardCode) => ({
            subjectId,
            cardCode,
            source: "EXPLICIT" as const,
            updatedAt: now,
          })),
        );
      }
      if (state === "COMPLETED" && subject.userId) {
        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "MEMBER",
          aggregateId: subject.userId,
          eventType: "INTEREST_PROFILE_COMPLETED",
          schemaVersion: 1,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: "INTEREST_PROFILE_COMPLETED",
            schema_version: 1,
            occurred_at: now.toISOString(),
            aggregate_type: "MEMBER",
            aggregate_id: subject.userId,
            data: { fact_id: subject.id, member_id: subject.userId },
          },
        });
      }
    });
  }

  return {
    listCards: () =>
      INTEREST_CARDS.map((card) => ({
        ...card,
        categoryCodes: [...card.categoryCodes],
        topicCodes: [...card.topicCodes],
      })),

    async getProfile(context) {
      const subject = await resolveSubject(context);
      return readView(subject, context);
    },

    async saveProfile(command) {
      const subject = await resolveSubject(command);
      if (command.onboardingState === "SKIPPED") {
        if (subject.kind !== "GUEST" || command.selectedCardCodes.length > 0) {
          throw new InterestProfileError(
            "INVALID_INTEREST_SELECTION",
            422,
            "Only Guests can skip, and a skipped profile cannot include selections.",
          );
        }
        await replaceSelections(subject, [], "SKIPPED");
      } else {
        await replaceSelections(
          subject,
          validateCompletedSelection(command.selectedCardCodes),
          "COMPLETED",
        );
      }
      return readView(subject, command);
    },

    async resetProfile(context) {
      const subject = await resolveSubject(context);
      const now = new Date();
      await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${subject.id}, 0))`,
        );
        await transaction
          .insert(interestProfiles)
          .values({
            subjectId: subject.id,
            onboardingState: "RESET",
            taxonomyVersion: INTEREST_TAXONOMY_VERSION,
            resetAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: interestProfiles.subjectId,
            set: {
              onboardingState: "RESET",
              taxonomyVersion: INTEREST_TAXONOMY_VERSION,
              profileVersion: sql`${interestProfiles.profileVersion} + 1`,
              completedAt: null,
              skippedAt: null,
              resetAt: now,
              updatedAt: now,
            },
          });
        await transaction
          .delete(subjectInterests)
          .where(eq(subjectInterests.subjectId, subject.id));
      });
      return readView(subject, context);
    },

    async mergeGuestProfile(command) {
      if (!command.sessionToken) {
        throw new InterestProfileError(
          "SESSION_INVALID",
          401,
          "A Member session is required to merge interests.",
        );
      }
      const memberSubject = await resolveSubject({ sessionToken: command.sessionToken });
      if (memberSubject.kind === "GUEST") {
        throw new InterestProfileError(
          "GUEST_CANNOT_MERGE",
          409,
          "A Member session is required to merge interests.",
        );
      }
      const [guest] = await database
        .select({ id: voterSubjects.id })
        .from(voterSubjects)
        .innerJoin(
          guestMemberLinks,
          and(
            eq(guestMemberLinks.guestSubjectId, voterSubjects.id),
            eq(guestMemberLinks.memberSubjectId, memberSubject.id),
          ),
        )
        .where(eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId))
        .limit(1);
      if (!guest) {
        throw new InterestProfileError(
          "MERGE_CANDIDATE_NOT_FOUND",
          404,
          "The linked Guest profile was not found.",
        );
      }
      const guestSelections = await database
        .select({ cardCode: subjectInterests.cardCode })
        .from(subjectInterests)
        .where(eq(subjectInterests.subjectId, guest.id));
      const guestSet = new Set(guestSelections.map((item) => item.cardCode));
      if (command.selectedCardCodes.some((code) => !guestSet.has(code))) {
        throw new InterestProfileError(
          "INVALID_INTEREST_SELECTION",
          422,
          "Only linked Guest interests can be merged.",
        );
      }
      const memberSelections = await database
        .select({ cardCode: subjectInterests.cardCode })
        .from(subjectInterests)
        .where(eq(subjectInterests.subjectId, memberSubject.id));
      const merged = normalizedCodes([
        ...memberSelections.map((item) => item.cardCode as InterestCardCode),
        ...command.selectedCardCodes,
      ]);
      await replaceSelections(memberSubject, validateCompletedSelection(merged), "COMPLETED");
      return readView(memberSubject, {
        sessionToken: command.sessionToken,
        anonymousSubjectId: command.anonymousSubjectId,
      });
    },
  };
}

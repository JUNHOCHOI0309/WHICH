import { createHash, randomBytes, randomUUID } from "node:crypto";

import { alias } from "drizzle-orm/pg-core";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  guestMemberLinks,
  commentReactions,
  issueChoices,
  memberIdentityLinks,
  memberSessions,
  members,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
  voteIntegrityDecisions,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type { MemberIdentityService, MemberView } from "./contracts.js";
import { MemberIdentityError } from "./errors.js";

const LINK_POLICY_VERSION = "guest-member-link-v1";
const EVENT_SCHEMA_VERSION = 1;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toMemberView(member: typeof members.$inferSelect): MemberView {
  return { id: member.id, displayName: member.displayName, status: member.status };
}

function normalizedDisplayName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, 80) : "WHICH 회원";
}

export function createMemberIdentityService(
  database: Database["db"],
  options: { sessionTtlSeconds: number; allowDevelopmentProvider: boolean },
): MemberIdentityService {
  return {
    async createSession(assertion) {
      if (assertion.provider === "DEVELOPMENT" && !options.allowDevelopmentProvider) {
        throw new MemberIdentityError(
          "DEVELOPMENT_PROVIDER_DISABLED",
          403,
          "The development identity provider is disabled in production.",
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1_000);
      const token = randomBytes(32).toString("base64url");

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${assertion.provider}:${assertion.providerSubject}`}, 0))`,
        );

        let [identity] = await transaction
          .select({ link: memberIdentityLinks, member: members })
          .from(memberIdentityLinks)
          .innerJoin(members, eq(memberIdentityLinks.memberId, members.id))
          .where(
            and(
              eq(memberIdentityLinks.provider, assertion.provider),
              eq(memberIdentityLinks.providerSubject, assertion.providerSubject),
            ),
          )
          .limit(1);

        if (!identity) {
          const [member] = await transaction
            .insert(members)
            .values({ displayName: normalizedDisplayName(assertion.displayName) })
            .returning();
          if (!member) throw new Error("Member insert did not return a row.");

          const [link] = await transaction
            .insert(memberIdentityLinks)
            .values({
              memberId: member.id,
              provider: assertion.provider,
              providerSubject: assertion.providerSubject,
              linkedAt: now,
              lastAuthenticatedAt: now,
            })
            .returning();
          if (!link) throw new Error("Identity link insert did not return a row.");

          await transaction.insert(voterSubjects).values({ kind: "MEMBER", userId: member.id });
          identity = { link, member };
        } else {
          await transaction
            .update(memberIdentityLinks)
            .set({ lastAuthenticatedAt: now })
            .where(eq(memberIdentityLinks.id, identity.link.id));
        }

        if (identity.member.status !== "ACTIVE") {
          throw new MemberIdentityError(
            "MEMBER_NOT_ACTIVE",
            403,
            "This member cannot start a session.",
          );
        }

        const [memberSubject] = await transaction
          .select({ id: voterSubjects.id })
          .from(voterSubjects)
          .where(
            and(eq(voterSubjects.kind, "MEMBER"), eq(voterSubjects.userId, identity.member.id)),
          )
          .limit(1);
        if (!memberSubject) throw new Error("Member voter subject is missing.");

        let guestLinked = false;
        let invalidatedDuplicateVotes = 0;
        let migratedReactions = 0;
        let mergedDuplicateReactions = 0;

        if (assertion.anonymousSubjectId) {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${assertion.anonymousSubjectId}, 0))`,
          );

          const [guestSubject] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, assertion.anonymousSubjectId),
              ),
            )
            .limit(1);
          if (!guestSubject) {
            throw new MemberIdentityError(
              "GUEST_SUBJECT_NOT_FOUND",
              404,
              "The Guest subject to link does not exist.",
            );
          }

          const [existingGuestLink] = await transaction
            .select({ memberId: guestMemberLinks.memberId })
            .from(guestMemberLinks)
            .where(eq(guestMemberLinks.guestSubjectId, guestSubject.id))
            .limit(1);

          if (existingGuestLink && existingGuestLink.memberId !== identity.member.id) {
            throw new MemberIdentityError(
              "GUEST_ALREADY_LINKED",
              409,
              "This Guest subject is already linked to a different member.",
            );
          }

          if (!existingGuestLink) {
            await transaction.insert(guestMemberLinks).values({
              guestSubjectId: guestSubject.id,
              memberSubjectId: memberSubject.id,
              memberId: identity.member.id,
              provider: assertion.provider,
              linkedAt: now,
            });
            guestLinked = true;

            const guestVote = alias(votes, "guest_vote");
            const memberVote = alias(votes, "member_vote");
            const guestChoice = alias(issueChoices, "guest_choice");
            const duplicates = await transaction
              .select({
                guestVoteId: guestVote.id,
                issueId: guestVote.issueId,
                issueVersion: guestVote.issueVersion,
                choiceCode: guestChoice.code,
                memberVoteId: memberVote.id,
              })
              .from(guestVote)
              .innerJoin(
                memberVote,
                and(
                  eq(memberVote.issueId, guestVote.issueId),
                  eq(memberVote.subjectId, memberSubject.id),
                  eq(memberVote.integrityState, "ACCEPTED"),
                ),
              )
              .innerJoin(guestChoice, eq(guestChoice.id, guestVote.choiceId))
              .where(
                and(
                  eq(guestVote.subjectId, guestSubject.id),
                  eq(guestVote.integrityState, "ACCEPTED"),
                ),
              );

            for (const duplicate of duplicates) {
              const [invalidatedVote] = await transaction
                .update(votes)
                .set({
                  integrityState: "INVALIDATED",
                  reasonCode: "GUEST_MEMBER_LINK_DUPLICATE",
                  invalidatedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(eq(votes.id, duplicate.guestVoteId), eq(votes.integrityState, "ACCEPTED")),
                )
                .returning({ id: votes.id });
              if (!invalidatedVote) continue;

              await transaction.insert(voteIntegrityDecisions).values({
                voteId: duplicate.guestVoteId,
                revision: sql`(select coalesce(max(revision), 0) + 1 from vote_integrity_decisions where vote_id = ${duplicate.guestVoteId})`,
                fromState: "ACCEPTED",
                toState: "INVALIDATED",
                action: "MERGED",
                reasonCode: "GUEST_MEMBER_LINK_DUPLICATE",
                policyVersion: LINK_POLICY_VERSION,
                actorType: "SYSTEM",
                evidence: { canonical_vote_id: duplicate.memberVoteId },
                decidedAt: now,
              });

              const aDecrement = duplicate.choiceCode === "A" ? 1 : 0;
              const bDecrement = duplicate.choiceCode === "B" ? 1 : 0;
              const [aggregate] = await transaction
                .update(voteAggregates)
                .set({
                  resultVersion: sql`${voteAggregates.resultVersion} + 1`,
                  acceptedACount: sql`${voteAggregates.acceptedACount} - ${aDecrement}`,
                  acceptedBCount: sql`${voteAggregates.acceptedBCount} - ${bDecrement}`,
                  acceptedVoteCount: sql`${voteAggregates.acceptedVoteCount} - 1`,
                  invalidatedVoteCount: sql`${voteAggregates.invalidatedVoteCount} + 1`,
                  displayedVoteCount: sql`${voteAggregates.displayedVoteCount} - 1`,
                  integrityState: "CORRECTED",
                  calculatedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(voteAggregates.issueId, duplicate.issueId),
                    eq(voteAggregates.issueVersion, duplicate.issueVersion),
                    gt(voteAggregates.acceptedVoteCount, 0),
                  ),
                )
                .returning();
              if (!aggregate) throw new Error("Vote aggregate correction did not return a row.");

              await transaction.insert(resultSnapshots).values({
                issueId: aggregate.issueId,
                issueVersion: aggregate.issueVersion,
                resultVersion: aggregate.resultVersion,
                acceptedACount: aggregate.acceptedACount,
                acceptedBCount: aggregate.acceptedBCount,
                displayedVoteCount: aggregate.displayedVoteCount,
                integrityState: aggregate.integrityState,
                calculatedAt: now,
              });

              const eventId = randomUUID();
              await transaction.insert(outboxEvents).values({
                id: eventId,
                aggregateType: "ISSUE_VERSION",
                aggregateId: `${aggregate.issueId}:${aggregate.issueVersion}`,
                eventType: "VOTE_INVALIDATED",
                schemaVersion: EVENT_SCHEMA_VERSION,
                occurredAt: now,
                payload: {
                  event_id: eventId,
                  event_type: "VOTE_INVALIDATED",
                  schema_version: EVENT_SCHEMA_VERSION,
                  occurred_at: now.toISOString(),
                  aggregate_type: "ISSUE_VERSION",
                  aggregate_id: `${aggregate.issueId}:${aggregate.issueVersion}`,
                  data: {
                    vote_id: duplicate.guestVoteId,
                    canonical_vote_id: duplicate.memberVoteId,
                    reason_code: "GUEST_MEMBER_LINK_DUPLICATE",
                    result_version: aggregate.resultVersion,
                  },
                },
              });
              invalidatedDuplicateVotes += 1;
            }

            const guestReactions = await transaction
              .select()
              .from(commentReactions)
              .where(
                and(
                  eq(commentReactions.subjectId, guestSubject.id),
                  eq(commentReactions.active, true),
                ),
              );
            for (const guestReaction of guestReactions) {
              const [memberReaction] = await transaction
                .select()
                .from(commentReactions)
                .where(
                  and(
                    eq(commentReactions.commentId, guestReaction.commentId),
                    eq(commentReactions.subjectId, memberSubject.id),
                    eq(commentReactions.code, guestReaction.code),
                  ),
                )
                .limit(1);

              if (memberReaction) {
                await transaction
                  .update(commentReactions)
                  .set({
                    active: true,
                    activatedAt: memberReaction.active ? memberReaction.activatedAt : now,
                    deactivatedAt: null,
                    mergedIntoReactionId: null,
                    updatedAt: now,
                  })
                  .where(eq(commentReactions.id, memberReaction.id));
                await transaction
                  .update(commentReactions)
                  .set({
                    active: false,
                    deactivatedAt: now,
                    mergedIntoReactionId: memberReaction.id,
                    updatedAt: now,
                  })
                  .where(eq(commentReactions.id, guestReaction.id));
                mergedDuplicateReactions += 1;
              } else {
                await transaction
                  .update(commentReactions)
                  .set({ subjectId: memberSubject.id, updatedAt: now })
                  .where(eq(commentReactions.id, guestReaction.id));
                migratedReactions += 1;
              }
            }

            if (migratedReactions > 0 || mergedDuplicateReactions > 0) {
              const eventId = randomUUID();
              await transaction.insert(outboxEvents).values({
                id: eventId,
                aggregateType: "MEMBER",
                aggregateId: identity.member.id,
                eventType: "COMMENT_REACTIONS_LINKED",
                schemaVersion: EVENT_SCHEMA_VERSION,
                occurredAt: now,
                payload: {
                  event_id: eventId,
                  event_type: "COMMENT_REACTIONS_LINKED",
                  schema_version: EVENT_SCHEMA_VERSION,
                  occurred_at: now.toISOString(),
                  aggregate_type: "MEMBER",
                  aggregate_id: identity.member.id,
                  data: {
                    guest_subject_id: guestSubject.id,
                    member_subject_id: memberSubject.id,
                    migrated_reactions: migratedReactions,
                    merged_duplicate_reactions: mergedDuplicateReactions,
                  },
                },
              });
            }
          }
        }

        await transaction.insert(memberSessions).values({
          memberId: identity.member.id,
          tokenHash: hashToken(token),
          expiresAt,
          createdAt: now,
          lastSeenAt: now,
        });

        return {
          token,
          expiresAt: expiresAt.toISOString(),
          member: toMemberView(identity.member),
          guestLink: {
            linked: guestLinked,
            invalidatedDuplicateVotes,
            migratedReactions,
            mergedDuplicateReactions,
          },
        };
      });
    },

    async getSession(token) {
      const now = new Date();
      const [session] = await database
        .select({ session: memberSessions, member: members })
        .from(memberSessions)
        .innerJoin(members, eq(memberSessions.memberId, members.id))
        .where(
          and(
            eq(memberSessions.tokenHash, hashToken(token)),
            isNull(memberSessions.revokedAt),
            gt(memberSessions.expiresAt, now),
            eq(members.status, "ACTIVE"),
          ),
        )
        .limit(1);
      if (!session) return null;

      await database
        .update(memberSessions)
        .set({ lastSeenAt: now })
        .where(eq(memberSessions.id, session.session.id));

      return {
        expiresAt: session.session.expiresAt.toISOString(),
        member: toMemberView(session.member),
      };
    },

    async revokeSession(token) {
      const [session] = await database
        .update(memberSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(memberSessions.tokenHash, hashToken(token)), isNull(memberSessions.revokedAt)),
        )
        .returning({ id: memberSessions.id });
      return Boolean(session);
    },
  };
}

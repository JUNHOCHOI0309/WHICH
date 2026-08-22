import { createHash, randomBytes, randomUUID } from "node:crypto";

import { alias } from "drizzle-orm/pg-core";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  guestMemberLinks,
  commentReactions,
  commentReports,
  issueChoices,
  memberIdentityLinks,
  memberProfiles,
  memberSessions,
  members,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
  voteIntegrityDecisions,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type {
  MemberIdentityService,
  MemberPrivateProfile,
  MemberProfileSettings,
  PublicCreatorProfile,
  MemberView,
  MemberVoteHistoryItem,
  MemberVoteLookupResult,
} from "./contracts.js";
import { encodeMemberVoteHistoryCursor } from "./cursor.js";
import { MemberIdentityError } from "./errors.js";
import { publicProfileInitials } from "./profile.js";

const LINK_POLICY_VERSION = "guest-member-link-v1";
const EVENT_SCHEMA_VERSION = 1;
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "help",
  "issues",
  "me",
  "moderator",
  "official",
  "operator",
  "settings",
  "support",
  "which",
]);

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

function normalizeHandle(value: string) {
  const handle = value.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new MemberIdentityError(
      "HANDLE_INVALID",
      400,
      "A handle must be 3 to 30 lowercase letters, numbers, or underscores.",
    );
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw new MemberIdentityError("HANDLE_RESERVED", 400, "This handle is reserved.");
  }
  return handle;
}

function normalizeBio(value: string | null) {
  if (value === null) return null;
  const withoutControls = Array.from(value.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const bio = withoutControls.replace(/\s+/g, " ");
  return bio.length > 0 ? bio.slice(0, 160) : null;
}

function profileSettings(profile: typeof memberProfiles.$inferSelect): MemberProfileSettings {
  return {
    handle: profile.handle,
    bio: profile.bio,
    visibility: profile.visibility,
    publicUrl: profile.visibility === "PUBLIC" ? `/user/${profile.handle}` : null,
  };
}

type PublicCreatorIssueRow = {
  issue_id: string;
  issue_version: number;
  question: string;
  category_code: string;
  published_at: Date | string;
  accepted_vote_count: number;
};

async function publicCreatorIssueRows(database: Database["db"], memberId: string) {
  const result = await database.execute<PublicCreatorIssueRow>(sql`
    with latest_published_versions as (
      select distinct on (iv.issue_id)
        iv.issue_id,
        iv.issue_version,
        iv.question,
        iv.primary_category_code,
        iv.published_at
      from issue_versions iv
      where iv.published_at is not null
        and iv.published_at <= now()
      order by iv.issue_id, iv.issue_version desc
    )
    select
      i.issue_id,
      lpv.issue_version,
      lpv.question,
      lpv.primary_category_code as category_code,
      lpv.published_at,
      coalesce(va.accepted_vote_count, 0)::int as accepted_vote_count
    from issue_authors ia
    inner join issues i on i.issue_id = ia.issue_id
    inner join latest_published_versions lpv on lpv.issue_id = i.issue_id
    left join vote_aggregates va
      on va.issue_id = i.issue_id and va.issue_version = lpv.issue_version
    where ia.member_id = ${memberId}
      and i.lifecycle = 'PUBLISHED'
      and i.visibility = 'VISIBLE'
      and i.participation = 'VOTING_OPEN'
      and i.risk_level = 'LOW'
      and i.is_political = false
      and (i.vote_open_at is null or i.vote_open_at <= now())
      and (i.vote_close_at is null or i.vote_close_at > now())
    order by lpv.published_at desc, i.issue_id desc
  `);
  return result.rows;
}

async function activeMemberSession(database: Database["db"], token: string) {
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

  return session;
}

type PrivateVoteRow = {
  vote_id: string;
  vote_attempt_id: string;
  issue_id: string;
  issue_version: number;
  question: string;
  category_code: string;
  choice: "A" | "B";
  choice_label: string;
  accepted_at: Date | string;
  result_version: number;
  accepted_a: number;
  accepted_b: number;
  displayed_total: number;
  result_integrity_state: MemberVoteHistoryItem["result"]["integrityState"];
};

function toPrivateVoteItem(row: PrivateVoteRow): MemberVoteHistoryItem {
  const acceptedAt = row.accepted_at instanceof Date ? row.accepted_at : new Date(row.accepted_at);
  return {
    voteId: row.vote_id,
    issueId: row.issue_id,
    issueVersion: row.issue_version,
    question: row.question,
    categoryCode: row.category_code,
    choice: row.choice,
    choiceLabel: row.choice_label,
    acceptedAt: acceptedAt.toISOString(),
    result: {
      resultVersion: row.result_version,
      acceptedA: row.accepted_a,
      acceptedB: row.accepted_b,
      displayedTotal: row.displayed_total,
      integrityState: row.result_integrity_state,
    },
  };
}

async function privateVoteRows(
  database: Database["db"],
  memberId: string,
  options: { limit: number; cursor?: { acceptedAt: Date; voteId: string }; issueId?: string },
) {
  const cursorAcceptedAt = options.cursor?.acceptedAt ?? null;
  const cursorVoteId = options.cursor?.voteId ?? null;
  const issueId = options.issueId ?? null;

  const result = await database.execute<PrivateVoteRow>(sql`
    with eligible_subjects as (
      select subject_id, 1 as subject_priority
      from voter_subjects
      where user_id = ${memberId}
        and subject_kind in ('MEMBER', 'VERIFIED_MEMBER')
      union all
      select guest_subject_id, 0 as subject_priority
      from guest_member_links
      where member_id = ${memberId}
    ), canonical_votes as (
      select distinct on (v.issue_id)
        v.vote_id,
        v.vote_attempt_id,
        v.issue_id,
        v.issue_version,
        v.choice_id,
        v.accepted_at
      from votes v
      inner join eligible_subjects es on es.subject_id = v.subject_id
      where v.integrity_state = 'ACCEPTED'
        and (${issueId}::uuid is null or v.issue_id = ${issueId}::uuid)
      order by
        v.issue_id,
        es.subject_priority desc,
        v.accepted_at desc,
        v.vote_id desc
    )
    select
      cv.vote_id,
      cv.vote_attempt_id,
      cv.issue_id,
      cv.issue_version,
      iv.question,
      iv.primary_category_code as category_code,
      ic.choice_code as choice,
      ic.label as choice_label,
      cv.accepted_at,
      va.result_version,
      va.accepted_a_count as accepted_a,
      va.accepted_b_count as accepted_b,
      va.displayed_vote_count as displayed_total,
      va.integrity_state as result_integrity_state
    from canonical_votes cv
    inner join issue_versions iv
      on iv.issue_id = cv.issue_id and iv.issue_version = cv.issue_version
    inner join issue_choices ic on ic.choice_id = cv.choice_id
    inner join vote_aggregates va
      on va.issue_id = cv.issue_id and va.issue_version = cv.issue_version
    where (
      ${cursorAcceptedAt}::timestamptz is null
      or (cv.accepted_at, cv.vote_id) < (${cursorAcceptedAt}::timestamptz, ${cursorVoteId}::uuid)
    )
    order by cv.accepted_at desc, cv.vote_id desc
    limit ${options.limit}
  `);

  return result.rows;
}

async function privateVoteParticipationCount(database: Database["db"], memberId: string) {
  const result = await database.execute<{ participation_count: number }>(sql`
    with eligible_subjects as (
      select subject_id
      from voter_subjects
      where user_id = ${memberId}
        and subject_kind in ('MEMBER', 'VERIFIED_MEMBER')
      union
      select guest_subject_id
      from guest_member_links
      where member_id = ${memberId}
    )
    select count(distinct v.issue_id)::int as participation_count
    from votes v
    inner join eligible_subjects es on es.subject_id = v.subject_id
    where v.integrity_state = 'ACCEPTED'
  `);
  return result.rows[0]?.participation_count ?? 0;
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
        let migratedReports = 0;
        let mergedDuplicateReports = 0;

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

            const guestReports = await transaction
              .select()
              .from(commentReports)
              .where(
                and(
                  eq(commentReports.subjectId, guestSubject.id),
                  eq(commentReports.counted, true),
                ),
              );
            for (const guestReport of guestReports) {
              const [memberReport] = await transaction
                .select({ id: commentReports.id })
                .from(commentReports)
                .where(
                  and(
                    eq(commentReports.commentId, guestReport.commentId),
                    eq(commentReports.subjectId, memberSubject.id),
                    eq(commentReports.counted, true),
                  ),
                )
                .limit(1);
              if (memberReport) {
                await transaction
                  .update(commentReports)
                  .set({
                    counted: false,
                    mergedIntoReportId: memberReport.id,
                    updatedAt: now,
                  })
                  .where(eq(commentReports.id, guestReport.id));
                mergedDuplicateReports += 1;
              } else {
                await transaction
                  .update(commentReports)
                  .set({ subjectId: memberSubject.id, updatedAt: now })
                  .where(eq(commentReports.id, guestReport.id));
                migratedReports += 1;
              }
            }

            if (migratedReports > 0 || mergedDuplicateReports > 0) {
              const eventId = randomUUID();
              await transaction.insert(outboxEvents).values({
                id: eventId,
                aggregateType: "MEMBER",
                aggregateId: identity.member.id,
                eventType: "COMMENT_REPORTS_LINKED",
                schemaVersion: EVENT_SCHEMA_VERSION,
                occurredAt: now,
                payload: {
                  event_id: eventId,
                  event_type: "COMMENT_REPORTS_LINKED",
                  schema_version: EVENT_SCHEMA_VERSION,
                  occurred_at: now.toISOString(),
                  aggregate_type: "MEMBER",
                  aggregate_id: identity.member.id,
                  data: {
                    guest_subject_id: guestSubject.id,
                    member_subject_id: memberSubject.id,
                    migrated_reports: migratedReports,
                    merged_duplicate_reports: mergedDuplicateReports,
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
      const session = await activeMemberSession(database, token);
      if (!session) return null;

      return {
        expiresAt: session.session.expiresAt.toISOString(),
        member: toMemberView(session.member),
      };
    },

    async linkIdentity(memberId, assertion) {
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
          sql`select pg_advisory_xact_lock(hashtextextended(${`member-link:${memberId}`}, 0))`,
        );
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${assertion.provider}:${assertion.providerSubject}`}, 0))`,
        );

        const [member] = await transaction
          .select()
          .from(members)
          .where(eq(members.id, memberId))
          .limit(1);
        if (!member || member.status !== "ACTIVE") {
          throw new MemberIdentityError(
            "MEMBER_NOT_ACTIVE",
            403,
            "This member cannot link another identity.",
          );
        }

        const [providerLink] = await transaction
          .select()
          .from(memberIdentityLinks)
          .where(
            and(
              eq(memberIdentityLinks.memberId, memberId),
              eq(memberIdentityLinks.provider, assertion.provider),
            ),
          )
          .limit(1);
        if (providerLink && providerLink.providerSubject !== assertion.providerSubject) {
          throw new MemberIdentityError(
            "PROVIDER_ALREADY_LINKED",
            409,
            "This member already has a different identity for the provider.",
          );
        }

        const [subjectLink] = await transaction
          .select()
          .from(memberIdentityLinks)
          .where(
            and(
              eq(memberIdentityLinks.provider, assertion.provider),
              eq(memberIdentityLinks.providerSubject, assertion.providerSubject),
            ),
          )
          .limit(1);
        if (subjectLink && subjectLink.memberId !== memberId) {
          throw new MemberIdentityError(
            "IDENTITY_ALREADY_LINKED",
            409,
            "This provider identity belongs to a different member.",
          );
        }

        let linked = false;
        if (subjectLink) {
          await transaction
            .update(memberIdentityLinks)
            .set({ lastAuthenticatedAt: now })
            .where(eq(memberIdentityLinks.id, subjectLink.id));
        } else {
          await transaction.insert(memberIdentityLinks).values({
            memberId,
            provider: assertion.provider,
            providerSubject: assertion.providerSubject,
            linkedAt: now,
            lastAuthenticatedAt: now,
          });
          linked = true;
        }

        await transaction.insert(memberSessions).values({
          memberId,
          tokenHash: hashToken(token),
          expiresAt,
          createdAt: now,
          lastSeenAt: now,
        });

        return {
          token,
          expiresAt: expiresAt.toISOString(),
          member: toMemberView(member),
          identity: { provider: assertion.provider, linked },
        };
      });
    },

    async getPrivateProfile(token, query): Promise<MemberPrivateProfile | null> {
      const session = await activeMemberSession(database, token);
      if (!session) return null;

      const [participationCount, rows, [publicProfile], identities] = await Promise.all([
        privateVoteParticipationCount(database, session.member.id),
        privateVoteRows(database, session.member.id, {
          limit: query.limit + 1,
          cursor: query.cursor,
        }),
        database
          .select()
          .from(memberProfiles)
          .where(eq(memberProfiles.memberId, session.member.id))
          .limit(1),
        database
          .select({
            provider: memberIdentityLinks.provider,
            linkedAt: memberIdentityLinks.linkedAt,
            lastAuthenticatedAt: memberIdentityLinks.lastAuthenticatedAt,
          })
          .from(memberIdentityLinks)
          .where(eq(memberIdentityLinks.memberId, session.member.id)),
      ]);
      const hasMore = rows.length > query.limit;
      const visibleRows = hasMore ? rows.slice(0, query.limit) : rows;
      const lastRow = visibleRows.at(-1);

      return {
        member: {
          ...toMemberView(session.member),
          joinedAt: session.member.createdAt.toISOString(),
          participationCount,
        },
        publicProfile: publicProfile ? profileSettings(publicProfile) : null,
        identities: identities.map((identity) => ({
          provider: identity.provider,
          linkedAt: identity.linkedAt.toISOString(),
          lastAuthenticatedAt: identity.lastAuthenticatedAt.toISOString(),
        })),
        votes: {
          items: visibleRows.map(toPrivateVoteItem),
          nextCursor:
            hasMore && lastRow
              ? encodeMemberVoteHistoryCursor({
                  acceptedAt:
                    lastRow.accepted_at instanceof Date
                      ? lastRow.accepted_at
                      : new Date(lastRow.accepted_at),
                  voteId: lastRow.vote_id,
                })
              : null,
        },
      };
    },

    async updateProfile(token, command) {
      const session = await activeMemberSession(database, token);
      if (!session) return null;

      const handle = normalizeHandle(command.handle);
      const bio = normalizeBio(command.bio);
      const now = new Date();

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${handle}, 0))`,
        );
        const [owner] = await transaction
          .select({ memberId: memberProfiles.memberId })
          .from(memberProfiles)
          .where(sql`lower(${memberProfiles.handle}) = ${handle}`)
          .limit(1);
        if (owner && owner.memberId !== session.member.id) {
          throw new MemberIdentityError("HANDLE_TAKEN", 409, "This handle is already in use.");
        }

        const [profile] = await transaction
          .insert(memberProfiles)
          .values({
            memberId: session.member.id,
            handle,
            bio,
            visibility: command.visibility,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: memberProfiles.memberId,
            set: { handle, bio, visibility: command.visibility, updatedAt: now },
          })
          .returning();
        if (!profile) throw new Error("Member profile update did not return a row.");
        return profileSettings(profile);
      });
    },

    async getPublicCreatorProfile(rawHandle): Promise<PublicCreatorProfile | null> {
      const handle = rawHandle.trim().toLowerCase();
      if (!HANDLE_PATTERN.test(handle)) return null;

      const [profile] = await database
        .select({ profile: memberProfiles, member: members })
        .from(memberProfiles)
        .innerJoin(members, eq(memberProfiles.memberId, members.id))
        .where(
          and(
            sql`lower(${memberProfiles.handle}) = ${handle}`,
            eq(memberProfiles.visibility, "PUBLIC"),
            eq(members.status, "ACTIVE"),
          ),
        )
        .limit(1);
      if (!profile) return null;

      const rows = await publicCreatorIssueRows(database, profile.member.id);
      return {
        creator: {
          displayName: profile.member.displayName,
          handle: profile.profile.handle,
          bio: profile.profile.bio,
          joinedMonth: profile.member.createdAt.toISOString().slice(0, 7),
          avatar: {
            kind: "INITIALS",
            initials: publicProfileInitials(profile.member.displayName),
          },
        },
        stats: {
          publishedIssueCount: rows.length,
          acceptedVoteCount: rows.reduce((total, row) => total + row.accepted_vote_count, 0),
        },
        issues: rows.slice(0, 12).map((row) => ({
          id: row.issue_id,
          version: row.issue_version,
          question: row.question,
          categoryCode: row.category_code,
          publishedAt:
            row.published_at instanceof Date
              ? row.published_at.toISOString()
              : new Date(row.published_at).toISOString(),
          acceptedVoteCount: row.accepted_vote_count,
        })),
      };
    },

    async findPrivateVote(token, issueId) {
      const session = await activeMemberSession(database, token);
      if (!session) return null;

      const [row] = await privateVoteRows(database, session.member.id, { limit: 1, issueId });
      const vote: MemberVoteLookupResult | null = row
        ? {
            outcome: "ACCEPTED",
            voteAttemptId: row.vote_attempt_id,
            voteId: row.vote_id,
            issueId: row.issue_id,
            issueVersion: row.issue_version,
            choice: row.choice,
            result: toPrivateVoteItem(row).result,
          }
        : null;

      return { member: toMemberView(session.member), vote };
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

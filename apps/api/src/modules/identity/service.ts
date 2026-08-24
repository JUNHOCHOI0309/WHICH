import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  authRateLimitWindows,
  guestMemberLinks,
  comments,
  commentReactions,
  commentReports,
  interestProfiles,
  issueChoices,
  issueAuthors,
  memberCredentials,
  memberAuthTokens,
  memberIdentityLinks,
  memberProfiles,
  memberSessions,
  members,
  outboxEvents,
  recommendationRequests,
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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;
const dummyPasswordHash = hashPassword("which-invalid-credential-padding", PASSWORD_HASH_OPTIONS);
const DEFAULT_AUTH_SECURITY = {
  verificationTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  rateLimitWindowSeconds: 900,
  signupLimit: 5,
  loginLimit: 10,
  emailDeliveryLimit: 3,
  tokenConsumeLimit: 10,
} as const;
type AuthSecurityOptions = {
  verificationTtlSeconds: number;
  passwordResetTtlSeconds: number;
  rateLimitWindowSeconds: number;
  signupLimit: number;
  loginLimit: number;
  emailDeliveryLimit: number;
  tokenConsumeLimit: number;
};
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

function normalizeEmail(value: string) {
  const email = value.trim().normalize("NFKC").toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new MemberIdentityError("EMAIL_INVALID", 400, "A valid email address is required.");
  }
  return email;
}

function validatePassword(value: string) {
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new MemberIdentityError(
      "PASSWORD_INVALID",
      400,
      `The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return value;
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
  options: {
    sessionTtlSeconds: number;
    allowDevelopmentProvider: boolean;
    requireVerifiedEmail?: boolean;
    authSecurity?: Partial<AuthSecurityOptions>;
  },
): MemberIdentityService {
  const authSecurity = { ...DEFAULT_AUTH_SECURITY, ...options.authSecurity };

  async function consumeAuthRateLimit(action: string, bucketKey: string, limit: number) {
    const now = new Date();
    await database.delete(authRateLimitWindows).where(lt(authRateLimitWindows.expiresAt, now));
    const windowMilliseconds = authSecurity.rateLimitWindowSeconds * 1_000;
    const windowStartedAt = new Date(
      Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds,
    );
    const expiresAt = new Date(windowStartedAt.getTime() + windowMilliseconds * 2);
    const bucketKeyHash = hashToken(`${action}:${bucketKey}`);
    const [window] = await database
      .insert(authRateLimitWindows)
      .values({
        action,
        bucketKeyHash,
        windowStartedAt,
        attemptCount: 1,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          authRateLimitWindows.action,
          authRateLimitWindows.bucketKeyHash,
          authRateLimitWindows.windowStartedAt,
        ],
        set: {
          attemptCount: sql`${authRateLimitWindows.attemptCount} + 1`,
          expiresAt,
          updatedAt: now,
        },
      })
      .returning({ attemptCount: authRateLimitWindows.attemptCount });
    if (!window || window.attemptCount > limit) {
      throw new MemberIdentityError(
        "AUTH_RATE_LIMITED",
        429,
        "Too many authentication attempts. Try again later.",
      );
    }
  }

  async function issueAuthEmailToken(
    purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
    emailInput: string,
    authRequestKey?: string,
  ) {
    const email = normalizeEmail(emailInput);
    await consumeAuthRateLimit(purpose, authRequestKey ?? email, authSecurity.emailDeliveryLimit);
    const [credential] = await database
      .select()
      .from(memberCredentials)
      .where(eq(memberCredentials.emailNormalized, email))
      .limit(1);
    if (!credential || (purpose === "EMAIL_VERIFICATION" && credential.emailVerifiedAt)) {
      return null;
    }

    const now = new Date();
    await database.delete(memberAuthTokens).where(lt(memberAuthTokens.expiresAt, now));
    const ttlSeconds =
      purpose === "EMAIL_VERIFICATION"
        ? authSecurity.verificationTtlSeconds
        : authSecurity.passwordResetTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
    const token = randomBytes(32).toString("base64url");
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`auth-token:${credential.id}:${purpose}`}, 0))`,
      );
      await transaction
        .update(memberAuthTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(memberAuthTokens.credentialId, credential.id),
            eq(memberAuthTokens.purpose, purpose),
            isNull(memberAuthTokens.consumedAt),
          ),
        );
      await transaction.insert(memberAuthTokens).values({
        credentialId: credential.id,
        purpose,
        tokenHash: hashToken(token),
        expiresAt,
        createdAt: now,
      });
    });
    return { email, token, expiresAt: expiresAt.toISOString() };
  }

  const service: MemberIdentityService = {
    async createSession(assertion) {
      if (assertion.provider === "DEVELOPMENT" && !options.allowDevelopmentProvider) {
        throw new MemberIdentityError(
          "DEVELOPMENT_PROVIDER_DISABLED",
          403,
          "The development identity provider is disabled in production.",
        );
      }

      const credentialInput = assertion.credential
        ? {
            email: normalizeEmail(assertion.credential.email),
            password: validatePassword(assertion.credential.password),
          }
        : null;
      if (credentialInput) {
        await consumeAuthRateLimit(
          "SIGNUP",
          assertion.authRequestKey ?? credentialInput.email,
          authSecurity.signupLimit,
        );
      }
      const credential = credentialInput
        ? {
            email: credentialInput.email,
            passwordHash: await hashPassword(credentialInput.password, PASSWORD_HASH_OPTIONS),
          }
        : null;
      const providerSubject =
        assertion.provider === "EMAIL"
          ? normalizeEmail(assertion.providerSubject)
          : assertion.providerSubject;
      if (assertion.provider === "EMAIL" && credential && credential.email !== providerSubject) {
        throw new MemberIdentityError(
          "EMAIL_INVALID",
          400,
          "The credential email must match the email identity.",
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1_000);
      const token = randomBytes(32).toString("base64url");

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${assertion.provider}:${providerSubject}`}, 0))`,
        );
        if (credential) {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${credential.email}`}, 0))`,
          );
        }

        let [identity] = await transaction
          .select({ link: memberIdentityLinks, member: members })
          .from(memberIdentityLinks)
          .innerJoin(members, eq(memberIdentityLinks.memberId, members.id))
          .where(
            and(
              eq(memberIdentityLinks.provider, assertion.provider),
              eq(memberIdentityLinks.providerSubject, providerSubject),
            ),
          )
          .limit(1);

        if (!identity) {
          if (assertion.createIfMissing === false) {
            throw new MemberIdentityError(
              "IDENTITY_SIGNUP_REQUIRED",
              409,
              "This identity must complete WHICH registration.",
            );
          }
          if (credential) {
            const [existingCredential] = await transaction
              .select({ id: memberCredentials.id })
              .from(memberCredentials)
              .where(eq(memberCredentials.emailNormalized, credential.email))
              .limit(1);
            if (existingCredential) {
              throw new MemberIdentityError(
                "CREDENTIAL_ALREADY_EXISTS",
                409,
                "This email is already registered.",
              );
            }
          }

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
              providerSubject,
              linkedAt: now,
              lastAuthenticatedAt: now,
            })
            .returning();
          if (!link) throw new Error("Identity link insert did not return a row.");

          if (credential) {
            await transaction.insert(memberCredentials).values({
              memberId: member.id,
              emailNormalized: credential.email,
              passwordHash: credential.passwordHash,
              emailVerifiedAt: null,
              passwordChangedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            if (assertion.provider !== "EMAIL") {
              await transaction.insert(memberIdentityLinks).values({
                memberId: member.id,
                provider: "EMAIL",
                providerSubject: credential.email,
                linkedAt: now,
                lastAuthenticatedAt: now,
              });
            }
          }

          await transaction.insert(voterSubjects).values({ kind: "MEMBER", userId: member.id });
          identity = { link, member };
        } else {
          if (credential) {
            throw new MemberIdentityError(
              "CREDENTIAL_ALREADY_EXISTS",
              409,
              "This account already exists. Sign in instead.",
            );
          }
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

    async createCredentialSession(assertion) {
      const email = normalizeEmail(assertion.email);
      await consumeAuthRateLimit(
        "LOGIN",
        assertion.authRequestKey ?? email,
        authSecurity.loginLimit,
      );
      const [credential] = await database
        .select({ credential: memberCredentials, member: members })
        .from(memberCredentials)
        .innerJoin(members, eq(memberCredentials.memberId, members.id))
        .where(eq(memberCredentials.emailNormalized, email))
        .limit(1);
      const passwordHash = credential?.credential.passwordHash ?? (await dummyPasswordHash);
      const passwordMatches = await verifyPassword(passwordHash, assertion.password).catch(
        () => false,
      );
      if (!credential || !passwordMatches || credential.member.status !== "ACTIVE") {
        throw new MemberIdentityError(
          "CREDENTIAL_INVALID",
          401,
          "The email or password is incorrect.",
        );
      }
      if (options.requireVerifiedEmail !== false && !credential.credential.emailVerifiedAt) {
        throw new MemberIdentityError(
          "EMAIL_UNVERIFIED",
          403,
          "Verify this email address before signing in.",
        );
      }

      return service.createSession({
        provider: "EMAIL",
        providerSubject: email,
        displayName: credential.member.displayName,
        anonymousSubjectId: assertion.anonymousSubjectId,
        createIfMissing: false,
      });
    },

    async addCredential(memberId, input) {
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(
        validatePassword(input.password),
        PASSWORD_HASH_OPTIONS,
      );
      const now = new Date();
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${email}`}, 0))`,
        );
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`member-credential:${memberId}`}, 0))`,
        );
        const [member] = await transaction
          .select()
          .from(members)
          .where(eq(members.id, memberId))
          .limit(1);
        if (!member || member.status !== "ACTIVE") {
          throw new MemberIdentityError("MEMBER_NOT_ACTIVE", 403, "This member is not active.");
        }
        const [existing] = await transaction
          .select({ id: memberCredentials.id })
          .from(memberCredentials)
          .where(
            sql`${memberCredentials.memberId} = ${memberId} or ${memberCredentials.emailNormalized} = ${email}`,
          )
          .limit(1);
        if (existing) {
          throw new MemberIdentityError(
            "CREDENTIAL_ALREADY_EXISTS",
            409,
            "This Member or email already has a credential.",
          );
        }
        await transaction.insert(memberCredentials).values({
          memberId,
          emailNormalized: email,
          passwordHash,
          emailVerifiedAt: null,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(memberIdentityLinks).values({
          memberId,
          provider: "EMAIL",
          providerSubject: email,
          linkedAt: now,
          lastAuthenticatedAt: now,
        });
        return { member: toMemberView(member), email };
      });
    },

    async requestEmailVerification(input) {
      return issueAuthEmailToken("EMAIL_VERIFICATION", input.email, input.authRequestKey);
    },

    async verifyEmail(input) {
      await consumeAuthRateLimit(
        "VERIFY_TOKEN",
        input.authRequestKey ?? hashToken(input.token),
        authSecurity.tokenConsumeLimit,
      );
      const tokenHash = hashToken(input.token);
      const now = new Date();
      return database.transaction(async (transaction) => {
        const [token] = await transaction
          .select({ id: memberAuthTokens.id, credentialId: memberAuthTokens.credentialId })
          .from(memberAuthTokens)
          .where(
            and(
              eq(memberAuthTokens.tokenHash, tokenHash),
              eq(memberAuthTokens.purpose, "EMAIL_VERIFICATION"),
              isNull(memberAuthTokens.consumedAt),
              gt(memberAuthTokens.expiresAt, now),
            ),
          )
          .limit(1);
        if (!token) {
          throw new MemberIdentityError(
            "AUTH_TOKEN_INVALID",
            400,
            "This verification link is invalid or expired.",
          );
        }
        const [consumed] = await transaction
          .update(memberAuthTokens)
          .set({ consumedAt: now })
          .where(and(eq(memberAuthTokens.id, token.id), isNull(memberAuthTokens.consumedAt)))
          .returning({ id: memberAuthTokens.id });
        if (!consumed) {
          throw new MemberIdentityError(
            "AUTH_TOKEN_INVALID",
            400,
            "This verification link is invalid or expired.",
          );
        }
        await transaction
          .update(memberCredentials)
          .set({ emailVerifiedAt: now, updatedAt: now })
          .where(eq(memberCredentials.id, token.credentialId));
        return { verified: true as const };
      });
    },

    async requestPasswordReset(input) {
      return issueAuthEmailToken("PASSWORD_RESET", input.email, input.authRequestKey);
    },

    async resetPassword(input) {
      const password = validatePassword(input.password);
      await consumeAuthRateLimit(
        "RESET_TOKEN",
        input.authRequestKey ?? hashToken(input.token),
        authSecurity.tokenConsumeLimit,
      );
      const passwordHash = await hashPassword(password, PASSWORD_HASH_OPTIONS);
      const tokenHash = hashToken(input.token);
      const now = new Date();
      return database.transaction(async (transaction) => {
        const [token] = await transaction
          .select({ id: memberAuthTokens.id, credentialId: memberAuthTokens.credentialId })
          .from(memberAuthTokens)
          .where(
            and(
              eq(memberAuthTokens.tokenHash, tokenHash),
              eq(memberAuthTokens.purpose, "PASSWORD_RESET"),
              isNull(memberAuthTokens.consumedAt),
              gt(memberAuthTokens.expiresAt, now),
            ),
          )
          .limit(1);
        if (!token) {
          throw new MemberIdentityError(
            "AUTH_TOKEN_INVALID",
            400,
            "This password reset link is invalid or expired.",
          );
        }
        const [credential] = await transaction
          .select({ memberId: memberCredentials.memberId })
          .from(memberCredentials)
          .where(eq(memberCredentials.id, token.credentialId))
          .limit(1);
        const [consumed] = await transaction
          .update(memberAuthTokens)
          .set({ consumedAt: now })
          .where(and(eq(memberAuthTokens.id, token.id), isNull(memberAuthTokens.consumedAt)))
          .returning({ id: memberAuthTokens.id });
        if (!credential || !consumed) {
          throw new MemberIdentityError(
            "AUTH_TOKEN_INVALID",
            400,
            "This password reset link is invalid or expired.",
          );
        }
        await transaction
          .update(memberCredentials)
          .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
          .where(eq(memberCredentials.id, token.credentialId));
        await transaction
          .update(memberAuthTokens)
          .set({ consumedAt: now })
          .where(
            and(
              eq(memberAuthTokens.credentialId, token.credentialId),
              eq(memberAuthTokens.purpose, "PASSWORD_RESET"),
              isNull(memberAuthTokens.consumedAt),
            ),
          );
        await transaction
          .update(memberSessions)
          .set({ revokedAt: now })
          .where(
            and(eq(memberSessions.memberId, credential.memberId), isNull(memberSessions.revokedAt)),
          );
        return { reset: true as const };
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
          sql`select pg_advisory_xact_lock(hashtextextended(${`${assertion.provider}:${assertion.providerSubject}`}, 0))`,
        );

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

        const memberIdsToLock = [
          ...new Set(subjectLink ? [memberId, subjectLink.memberId] : [memberId]),
        ].sort((left, right) => left.localeCompare(right));
        for (const lockedMemberId of memberIdsToLock) {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`member-link:${lockedMemberId}`}, 0))`,
          );
        }

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

        let linked = false;
        let memberMerged = false;
        if (subjectLink && subjectLink.memberId !== memberId) {
          const sourceMemberId = subjectLink.memberId;
          const [sourceMember] = await transaction
            .select({ status: members.status })
            .from(members)
            .where(eq(members.id, sourceMemberId))
            .limit(1);
          const [targetSubject] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(eq(voterSubjects.userId, memberId))
            .limit(1);
          const [sourceSubject] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(eq(voterSubjects.userId, sourceMemberId))
            .limit(1);

          if (
            !sourceMember ||
            sourceMember.status !== "ACTIVE" ||
            !targetSubject ||
            !sourceSubject
          ) {
            throw new MemberIdentityError(
              "MEMBER_MERGE_REQUIRES_REVIEW",
              409,
              "The existing member cannot be merged automatically.",
            );
          }

          const mergeSafety = await transaction.execute<{
            provider_conflict: boolean;
            direct_activity: boolean;
            duplicate_vote: boolean;
          }>(sql`
            select
              exists (
                select 1
                from member_identity_links source_link
                inner join member_identity_links target_link
                  on target_link.provider = source_link.provider
                where source_link.member_id = ${sourceMemberId}
                  and target_link.member_id = ${memberId}
              ) as provider_conflict,
              (
                exists (select 1 from member_profiles where member_id = ${sourceMemberId})
                or exists (select 1 from issue_authors where member_id = ${sourceMemberId})
                or exists (select 1 from comment_write_attempts where member_id = ${sourceMemberId})
                or exists (select 1 from vote_attempts where subject_id = ${sourceSubject.id})
                or exists (select 1 from votes where subject_id = ${sourceSubject.id})
                or exists (select 1 from comments where author_subject_id = ${sourceSubject.id})
                or exists (
                  select 1 from comment_reactions
                  where subject_id = ${sourceSubject.id} or origin_subject_id = ${sourceSubject.id}
                )
                or exists (
                  select 1 from comment_reaction_attempts where actor_subject_id = ${sourceSubject.id}
                )
                or exists (
                  select 1 from comment_reports
                  where subject_id = ${sourceSubject.id} or origin_subject_id = ${sourceSubject.id}
                )
                or exists (
                  select 1 from comment_report_attempts where actor_subject_id = ${sourceSubject.id}
                )
                or exists (select 1 from interest_profiles where subject_id = ${sourceSubject.id})
              ) as direct_activity,
              exists (
                select 1
                from votes source_vote
                where source_vote.integrity_state = 'ACCEPTED'
                  and source_vote.subject_id in (
                    select guest_subject_id from guest_member_links where member_id = ${sourceMemberId}
                  )
                  and exists (
                    select 1
                    from votes target_vote
                    where target_vote.issue_id = source_vote.issue_id
                      and target_vote.integrity_state = 'ACCEPTED'
                      and target_vote.subject_id in (
                        select subject_id from voter_subjects where user_id = ${memberId}
                        union
                        select guest_subject_id from guest_member_links where member_id = ${memberId}
                      )
                  )
              ) as duplicate_vote
          `);
          const safety = mergeSafety.rows[0];
          if (
            !safety ||
            safety.provider_conflict ||
            safety.direct_activity ||
            safety.duplicate_vote
          ) {
            throw new MemberIdentityError(
              "MEMBER_MERGE_REQUIRES_REVIEW",
              409,
              "The existing member has activity or conflicts that require reviewed merging.",
            );
          }

          const transferredGuestLinks = await transaction
            .update(guestMemberLinks)
            .set({ memberId, memberSubjectId: targetSubject.id })
            .where(eq(guestMemberLinks.memberId, sourceMemberId))
            .returning({ id: guestMemberLinks.id });

          await transaction
            .update(memberIdentityLinks)
            .set({ memberId })
            .where(eq(memberIdentityLinks.memberId, sourceMemberId));
          await transaction
            .update(memberIdentityLinks)
            .set({ lastAuthenticatedAt: now })
            .where(eq(memberIdentityLinks.id, subjectLink.id));
          await transaction
            .update(memberSessions)
            .set({ revokedAt: now })
            .where(
              and(eq(memberSessions.memberId, sourceMemberId), isNull(memberSessions.revokedAt)),
            );
          await transaction
            .update(members)
            .set({ status: "DELETED", updatedAt: now })
            .where(eq(members.id, sourceMemberId));

          const eventId = randomUUID();
          await transaction.insert(outboxEvents).values({
            id: eventId,
            aggregateType: "MEMBER",
            aggregateId: memberId,
            eventType: "MEMBER_IDENTITIES_MERGED",
            schemaVersion: EVENT_SCHEMA_VERSION,
            occurredAt: now,
            payload: {
              event_id: eventId,
              event_type: "MEMBER_IDENTITIES_MERGED",
              schema_version: EVENT_SCHEMA_VERSION,
              occurred_at: now.toISOString(),
              aggregate_type: "MEMBER",
              aggregate_id: memberId,
              data: {
                source_member_id: sourceMemberId,
                target_member_id: memberId,
                transferred_guest_links: transferredGuestLinks.length,
                provider: assertion.provider,
              },
            },
          });
          linked = true;
          memberMerged = true;
        } else if (subjectLink) {
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
          identity: { provider: assertion.provider, linked, memberMerged },
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

    async deleteAccount(token, password) {
      const session = await activeMemberSession(database, token);
      if (!session) return null;

      const [credential] = await database
        .select({ id: memberCredentials.id, passwordHash: memberCredentials.passwordHash })
        .from(memberCredentials)
        .where(eq(memberCredentials.memberId, session.member.id))
        .limit(1);
      if (!credential) {
        throw new MemberIdentityError(
          "CREDENTIAL_REQUIRED",
          409,
          "Email and password login must be configured before account deletion.",
        );
      }
      if (!(await verifyPassword(credential.passwordHash, password))) {
        throw new MemberIdentityError("CREDENTIAL_INVALID", 401, "The password is invalid.");
      }

      const now = new Date();
      return database.transaction(async (transaction) => {
        const locked = await transaction.execute<{ status: string }>(sql`
          select status
          from members
          where member_id = ${session.member.id}
          for update
        `);
        if (locked.rows[0]?.status !== "ACTIVE") {
          throw new MemberIdentityError("MEMBER_NOT_ACTIVE", 403, "The Member is not active.");
        }

        const subjects = await transaction
          .select({ id: voterSubjects.id })
          .from(voterSubjects)
          .where(eq(voterSubjects.userId, session.member.id));
        const subjectIds = subjects.map((subject) => subject.id);

        if (subjectIds.length > 0) {
          await transaction
            .update(comments)
            .set({ authorDisplayName: "탈퇴한 사용자", updatedAt: now })
            .where(inArray(comments.authorSubjectId, subjectIds));
          await transaction
            .update(recommendationRequests)
            .set({ subjectId: null })
            .where(inArray(recommendationRequests.subjectId, subjectIds));
          await transaction
            .delete(interestProfiles)
            .where(inArray(interestProfiles.subjectId, subjectIds));
        }

        await transaction
          .delete(guestMemberLinks)
          .where(eq(guestMemberLinks.memberId, session.member.id));
        await transaction.delete(issueAuthors).where(eq(issueAuthors.memberId, session.member.id));
        await transaction
          .delete(memberProfiles)
          .where(eq(memberProfiles.memberId, session.member.id));
        await transaction
          .delete(memberIdentityLinks)
          .where(eq(memberIdentityLinks.memberId, session.member.id));
        await transaction
          .delete(memberCredentials)
          .where(eq(memberCredentials.memberId, session.member.id));
        await transaction
          .update(memberSessions)
          .set({ revokedAt: now })
          .where(
            and(eq(memberSessions.memberId, session.member.id), isNull(memberSessions.revokedAt)),
          );

        if (subjectIds.length > 0) {
          await transaction
            .update(voterSubjects)
            .set({
              kind: "DELETED_MEMBER",
              anonymousSubjectId: null,
              userId: null,
              verifiedUniquenessHandle: null,
              expiresAt: null,
              lastSeenAt: now,
            })
            .where(inArray(voterSubjects.id, subjectIds));
        }

        await transaction
          .update(members)
          .set({ status: "DELETED", displayName: "탈퇴한 사용자", updatedAt: now })
          .where(eq(members.id, session.member.id));

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "MEMBER",
          aggregateId: session.member.id,
          eventType: "MEMBER_ACCOUNT_DELETED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: "MEMBER_ACCOUNT_DELETED",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "MEMBER",
            aggregate_id: session.member.id,
            data: { anonymized_subject_count: subjectIds.length },
          },
        });

        return { deleted: true } as const;
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
  return service;
}

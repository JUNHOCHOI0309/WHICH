import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueAuthors,
  issueChoices,
  issueInterestCards,
  issueMediaAssets,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  issues,
  issueVersions,
  memberSessions,
  members,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
} from "../../database/schema/index.js";
import {
  INTEREST_CARD_CODES,
  INTEREST_TAXONOMY_VERSION,
  type InterestCardCode,
} from "../interests/contracts.js";
import { computeIssueContentHash } from "../issue-publication/content-hash.js";
import type {
  CreateMemberIssueCommand,
  CreatedMemberIssue,
  MemberIssueSubmission,
  IssueWriteService,
  ResubmitMemberIssueCommand,
} from "./contracts.js";
import { sealIssueVersionSnapshot } from "../content-revisions/service.js";
import { evaluateTextRules, normalizeModerationText } from "../moderation/rule-engine.js";
import { IssueWriteError } from "./errors.js";

const DAILY_CREATION_LIMIT = 3;
const ISSUE_VERSION = 1 as const;
const EXPERIENCE_MODE = "PLAYFUL_QUICK";
const URL_PATTERN = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|kr|io)(?:\/|\b))/iu;
const RESTRICTED_TOPIC_PATTERN =
  /(?:정치|정당|선거|대통령|국회의원|후보자|탄핵|politic|election|president|parliament|suicide|자살|살인|성폭행|마약|불법도박)/iu;

const PRIMARY_CATEGORY_BY_CARD: Record<InterestCardCode, string> = {
  DAILY_LIFE: "LIFE",
  FOOD: "LIFE",
  TRAVEL: "LIFE",
  RELATIONSHIP: "RELATIONSHIP",
  WORK: "WORK_CAREER",
  ECONOMY_CONSUMPTION: "ECONOMY_CONSUMPTION",
  TECH: "TECH",
  GAME: "CULTURE_ENT",
  MOVIE_DRAMA: "CULTURE_ENT",
  MUSIC_CONTENT: "CULTURE_ENT",
  SPORTS: "SPORTS",
  EDUCATION: "EDUCATION",
  SOCIETY: "SOCIETY",
  HOBBY: "LIFE",
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function deterministicUuid(scope: string) {
  const bytes = createHash("sha256")
    .update(`which:member-issue:v1:${scope}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeInline(value: string) {
  return normalizeModerationText(value, "INLINE");
}

function characterLength(value: string) {
  return Array.from(value).length;
}

function invalidLength(value: string, minimum: number, maximum: number) {
  const length = characterLength(value);
  return length < minimum || length > maximum;
}

function normalizeCommand(command: CreateMemberIssueCommand) {
  let question = normalizeInline(command.question);
  const context = command.context ? normalizeInline(command.context) : null;
  const choiceA = normalizeInline(command.choiceA);
  const choiceB = normalizeInline(command.choiceB);

  if (question && !/[?？]$/u.test(question)) question = `${question}?`;

  if (
    invalidLength(question, 5, 120) ||
    (context !== null && invalidLength(context, 1, 240)) ||
    invalidLength(choiceA, 1, 50) ||
    invalidLength(choiceB, 1, 50) ||
    choiceA.localeCompare(choiceB, "ko", { sensitivity: "base" }) === 0 ||
    !INTEREST_CARD_CODES.includes(command.interestCardCode)
  ) {
    throw new IssueWriteError(
      "INVALID_ISSUE_CONTENT",
      422,
      "질문, 설명, A/B 선택지와 관심 주제를 다시 확인해 주세요.",
    );
  }

  const mediaAssetAId = command.mediaAssetAId ?? null;
  const mediaAssetBId = command.mediaAssetBId ?? null;
  if (
    Boolean(mediaAssetAId) !== Boolean(mediaAssetBId) ||
    (mediaAssetAId !== null && mediaAssetAId === mediaAssetBId)
  ) {
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_MEDIA_INVALID",
      422,
      "선택지 이미지는 A와 B를 함께 등록하고 서로 다른 이미지를 사용해 주세요.",
    );
  }

  const combined = [question, context, choiceA, choiceB].filter(Boolean).join(" ");
  const commonRules = evaluateTextRules({
    value: combined,
    minimumLength: 1,
    maximumLength: 320,
    allowUrls: false,
    trustTier: "MEMBER",
  });
  if (
    URL_PATTERN.test(combined) ||
    RESTRICTED_TOPIC_PATTERN.test(combined) ||
    commonRules.signals.some((signal) => signal.severity !== "INFO")
  ) {
    throw new IssueWriteError(
      "UNSAFE_ISSUE_CONTENT",
      422,
      "v1에서는 링크가 없고 정치·고위험 주제가 아닌 일상형 질문만 만들 수 있어요.",
    );
  }

  return {
    question,
    context,
    choiceA,
    choiceB,
    mediaAssetAId,
    mediaAssetBId,
    interestCardCode: command.interestCardCode,
  };
}

async function requireActiveMember(database: Pick<Database["db"], "select">, sessionToken: string) {
  const now = new Date();
  const [session] = await database
    .select({ memberId: memberSessions.memberId })
    .from(memberSessions)
    .innerJoin(members, eq(memberSessions.memberId, members.id))
    .where(
      and(
        eq(memberSessions.tokenHash, hashToken(sessionToken)),
        isNull(memberSessions.revokedAt),
        gt(memberSessions.expiresAt, now),
        eq(members.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!session) {
    throw new IssueWriteError(
      "SESSION_REQUIRED",
      401,
      "질문을 제출하려면 활성 Member 로그인이 필요합니다.",
    );
  }
  return session;
}

function toSubmission(row: typeof memberIssueSubmissions.$inferSelect): MemberIssueSubmission {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status as MemberIssueSubmission["status"],
    question: row.question,
    context: row.context,
    choiceA: row.choiceA,
    choiceB: row.choiceB,
    mediaAssetAId: row.mediaAssetAId,
    mediaAssetBId: row.mediaAssetBId,
    interestCardCode: row.interestCardCode as InterestCardCode,
    reviewNote: row.reviewNote,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireOwnedSubmissionMedia(
  database: Pick<Database["db"], "select">,
  memberId: string,
  assetIds: Array<string | null>,
) {
  for (const assetId of assetIds) {
    if (!assetId) continue;
    const [asset] = await database
      .select({
        uploadedByMemberId: issueMediaAssets.uploadedByMemberId,
        sourceType: issueMediaAssets.sourceType,
        processingState: issueMediaAssets.processingState,
        moderationState: issueMediaAssets.moderationState,
        storageState: issueMediaAssets.storageState,
        rightsState: issueMediaAssets.rightsState,
      })
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (
      !asset ||
      asset.uploadedByMemberId !== memberId ||
      asset.sourceType !== "MEMBER_SUBMISSION" ||
      asset.processingState !== "READY" ||
      asset.moderationState !== "PENDING" ||
      asset.storageState !== "STAGED" ||
      asset.rightsState !== "ASSERTED"
    ) {
      throw new IssueWriteError(
        "ISSUE_SUBMISSION_MEDIA_INVALID",
        422,
        "선택지 이미지가 현재 계정의 검수 대기 상태인지 확인해 주세요.",
      );
    }
  }
}

export function createIssueWriteService(database: Database["db"]): IssueWriteService {
  return {
    async submitMemberIssue(command) {
      const normalized = normalizeCommand(command);
      const session = await requireActiveMember(database, command.sessionToken);
      const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
      const submissionId = deterministicUuid(
        `${session.memberId}:${command.idempotencyKey}:submission`,
      );

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${session.memberId}`}, 0))`,
        );
        await requireOwnedSubmissionMedia(transaction, session.memberId, [
          normalized.mediaAssetAId,
          normalized.mediaAssetBId,
        ]);

        const [existing] = await transaction
          .select()
          .from(memberIssueSubmissions)
          .where(
            and(
              eq(memberIssueSubmissions.memberId, session.memberId),
              eq(memberIssueSubmissions.idempotencyKey, command.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (existing.contentHash !== contentHash) {
            throw new IssueWriteError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "같은 요청 키가 다른 질문 제출에 이미 사용되었습니다.",
            );
          }
          return { submission: toSubmission(existing), created: false };
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
        const [submissionCount] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(memberIssueSubmissions)
          .where(
            and(
              eq(memberIssueSubmissions.memberId, session.memberId),
              gt(memberIssueSubmissions.submittedAt, since),
            ),
          );
        if ((submissionCount?.count ?? 0) >= DAILY_CREATION_LIMIT) {
          throw new IssueWriteError(
            "ISSUE_CREATION_LIMIT_REACHED",
            429,
            "질문은 24시간 동안 최대 3개까지 제출할 수 있어요.",
          );
        }

        const [created] = await transaction
          .insert(memberIssueSubmissions)
          .values({
            id: submissionId,
            memberId: session.memberId,
            idempotencyKey: command.idempotencyKey,
            question: normalized.question,
            context: normalized.context,
            choiceA: normalized.choiceA,
            choiceB: normalized.choiceB,
            mediaAssetAId: normalized.mediaAssetAId,
            mediaAssetBId: normalized.mediaAssetBId,
            interestCardCode: normalized.interestCardCode,
            contentHash,
          })
          .returning();
        await transaction.insert(memberIssueSubmissionRevisions).values({
          id: deterministicUuid(`${submissionId}:revision:1`),
          submissionId,
          memberId: session.memberId,
          revision: 1,
          idempotencyKey: command.idempotencyKey,
          question: normalized.question,
          context: normalized.context,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          mediaAssetAId: normalized.mediaAssetAId,
          mediaAssetBId: normalized.mediaAssetBId,
          interestCardCode: normalized.interestCardCode,
          contentHash,
        });
        return { submission: toSubmission(created!), created: true };
      });
    },

    async resubmitMemberIssue(command: ResubmitMemberIssueCommand) {
      const normalized = normalizeCommand(command);
      const session = await requireActiveMember(database, command.sessionToken);
      const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${command.submissionId}`}, 0))`,
        );
        await requireOwnedSubmissionMedia(transaction, session.memberId, [
          normalized.mediaAssetAId,
          normalized.mediaAssetBId,
        ]);

        const [idempotentRevision] = await transaction
          .select()
          .from(memberIssueSubmissionRevisions)
          .where(
            and(
              eq(memberIssueSubmissionRevisions.memberId, session.memberId),
              eq(memberIssueSubmissionRevisions.idempotencyKey, command.idempotencyKey),
            ),
          )
          .limit(1);
        if (idempotentRevision) {
          if (
            idempotentRevision.submissionId !== command.submissionId ||
            idempotentRevision.contentHash !== contentHash
          ) {
            throw new IssueWriteError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "같은 요청 키가 다른 질문 수정본에 이미 사용되었습니다.",
            );
          }
          const [current] = await transaction
            .select()
            .from(memberIssueSubmissions)
            .where(
              and(
                eq(memberIssueSubmissions.id, command.submissionId),
                eq(memberIssueSubmissions.memberId, session.memberId),
              ),
            )
            .limit(1);
          if (!current) {
            throw new IssueWriteError(
              "ISSUE_SUBMISSION_NOT_FOUND",
              404,
              "제출 건을 찾지 못했습니다.",
            );
          }
          return { submission: toSubmission(current), created: false };
        }

        const [current] = await transaction
          .select()
          .from(memberIssueSubmissions)
          .where(
            and(
              eq(memberIssueSubmissions.id, command.submissionId),
              eq(memberIssueSubmissions.memberId, session.memberId),
            ),
          )
          .limit(1);
        if (!current) {
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_FOUND",
            404,
            "제출 건을 찾지 못했습니다.",
          );
        }
        if (current.revision !== command.expectedRevision) {
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_REVISION_CONFLICT",
            409,
            "이미 더 최신 수정본이 제출되었습니다. 상태를 새로 불러와 주세요.",
          );
        }
        if (current.status !== "NEEDS_CHANGES") {
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_EDITABLE",
            409,
            "운영자가 수정을 요청한 질문만 다시 제출할 수 있습니다.",
          );
        }

        const revision = current.revision + 1;
        const now = new Date();
        const [updated] = await transaction
          .update(memberIssueSubmissions)
          .set({
            revision,
            status: "PENDING",
            question: normalized.question,
            context: normalized.context,
            choiceA: normalized.choiceA,
            choiceB: normalized.choiceB,
            mediaAssetAId: normalized.mediaAssetAId,
            mediaAssetBId: normalized.mediaAssetBId,
            interestCardCode: normalized.interestCardCode,
            contentHash,
            reviewNote: null,
            reviewedAt: null,
            submittedAt: now,
            updatedAt: now,
          })
          .where(eq(memberIssueSubmissions.id, current.id))
          .returning();
        await transaction.insert(memberIssueSubmissionRevisions).values({
          id: deterministicUuid(`${current.id}:revision:${revision}`),
          submissionId: current.id,
          memberId: session.memberId,
          revision,
          idempotencyKey: command.idempotencyKey,
          question: normalized.question,
          context: normalized.context,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          mediaAssetAId: normalized.mediaAssetAId,
          mediaAssetBId: normalized.mediaAssetBId,
          interestCardCode: normalized.interestCardCode,
          contentHash,
          submittedAt: now,
        });
        return { submission: toSubmission(updated!), created: true };
      });
    },

    async listMemberIssueSubmissions(command) {
      const session = await requireActiveMember(database, command.sessionToken);
      const rows = await database
        .select()
        .from(memberIssueSubmissions)
        .where(eq(memberIssueSubmissions.memberId, session.memberId))
        .orderBy(desc(memberIssueSubmissions.updatedAt))
        .limit(Math.min(Math.max(command.limit, 1), 20));
      return { items: rows.map(toSubmission) };
    },

    async createMemberIssue(command): Promise<CreatedMemberIssue> {
      const normalized = normalizeCommand(command);

      return database.transaction(
        async (transaction) => {
          const now = new Date();
          const [session] = await transaction
            .select({ memberId: memberSessions.memberId })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, now),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (!session) {
            throw new IssueWriteError(
              "SESSION_REQUIRED",
              401,
              "질문을 만들려면 활성 Member 로그인이 필요합니다.",
            );
          }

          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue:${session.memberId}`}, 0))`,
          );

          const issueId = deterministicUuid(`${session.memberId}:${command.idempotencyKey}:issue`);
          const choiceAId = deterministicUuid(
            `${session.memberId}:${command.idempotencyKey}:choice:a`,
          );
          const choiceBId = deterministicUuid(
            `${session.memberId}:${command.idempotencyKey}:choice:b`,
          );
          const choices = [
            { id: choiceAId, code: "A" as const, label: normalized.choiceA },
            { id: choiceBId, code: "B" as const, label: normalized.choiceB },
          ];
          const contentHash = computeIssueContentHash({
            question: normalized.question,
            context: normalized.context ?? "",
            choices,
          });

          const [existing] = await transaction
            .select({
              memberId: issueAuthors.memberId,
              question: issueVersions.question,
              context: issueVersions.context,
              contentHash: issueVersions.contentHash,
              publishedAt: issueVersions.publishedAt,
              interestCardCode: issueInterestCards.cardCode,
            })
            .from(issueVersions)
            .innerJoin(issueAuthors, eq(issueAuthors.issueId, issueVersions.issueId))
            .innerJoin(
              issueInterestCards,
              and(
                eq(issueInterestCards.issueId, issueVersions.issueId),
                eq(issueInterestCards.issueVersion, issueVersions.version),
              ),
            )
            .where(
              and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, ISSUE_VERSION)),
            )
            .limit(1);

          if (existing) {
            if (
              existing.memberId !== session.memberId ||
              existing.contentHash !== contentHash ||
              existing.interestCardCode !== normalized.interestCardCode
            ) {
              throw new IssueWriteError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "같은 요청 키가 다른 질문에 이미 사용되었습니다.",
              );
            }
            return {
              issue: {
                id: issueId,
                version: ISSUE_VERSION,
                question: existing.question,
                context: existing.context,
                choices: [
                  { code: "A", label: normalized.choiceA },
                  { code: "B", label: normalized.choiceB },
                ],
                interestCardCode: normalized.interestCardCode,
                publishedAt: existing.publishedAt!.toISOString(),
              },
              created: false,
            };
          }

          const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
          const [creationCount] = await transaction
            .select({ count: sql<number>`count(*)::int` })
            .from(issueAuthors)
            .where(
              and(
                eq(issueAuthors.memberId, session.memberId),
                gt(issueAuthors.assignedAt, windowStart),
              ),
            );
          if ((creationCount?.count ?? 0) >= DAILY_CREATION_LIMIT) {
            throw new IssueWriteError(
              "ISSUE_CREATION_LIMIT_REACHED",
              429,
              "질문은 24시간 동안 최대 3개까지 만들 수 있어요.",
            );
          }

          await transaction.insert(issues).values({
            id: issueId,
            lifecycle: "PUBLISHED",
            visibility: "VISIBLE",
            participation: "VOTING_OPEN",
            resultVisibility: "PRE_VOTE_HIDDEN",
            feedEligibility: "ELIGIBLE",
            riskLevel: "LOW",
            isPolitical: false,
            voteOpenAt: now,
          });
          await transaction.insert(issueVersions).values({
            issueId,
            version: ISSUE_VERSION,
            question: normalized.question,
            context: normalized.context,
            contentHash,
            primaryCategoryCode: PRIMARY_CATEGORY_BY_CARD[normalized.interestCardCode],
            experienceModeCode: EXPERIENCE_MODE,
            taxonomyVersion: INTEREST_TAXONOMY_VERSION,
            publishedAt: now,
          });
          await transaction.insert(issueChoices).values(
            choices.map((choice) => ({
              id: choice.id,
              issueId,
              issueVersion: ISSUE_VERSION,
              code: choice.code,
              label: choice.label,
            })),
          );
          await sealIssueVersionSnapshot(transaction, issueId, ISSUE_VERSION);
          await transaction.insert(issueInterestCards).values({
            issueId,
            issueVersion: ISSUE_VERSION,
            cardCode: normalized.interestCardCode,
            taxonomyVersion: INTEREST_TAXONOMY_VERSION,
            weight: 100,
          });
          await transaction.insert(issueAuthors).values({
            issueId,
            memberId: session.memberId,
            assignedAt: now,
          });
          await transaction.insert(voteAggregates).values({ issueId, issueVersion: ISSUE_VERSION });
          await transaction.insert(resultSnapshots).values({
            issueId,
            issueVersion: ISSUE_VERSION,
            resultVersion: 1,
            acceptedACount: 0,
            acceptedBCount: 0,
            displayedVoteCount: 0,
            integrityState: "NORMAL",
          });

          const eventId = randomUUID();
          const aggregateId = `${issueId}:${ISSUE_VERSION}`;
          await transaction.insert(outboxEvents).values({
            id: eventId,
            aggregateType: "ISSUE_VERSION",
            aggregateId,
            eventType: "ISSUE_PUBLISHED",
            schemaVersion: 1,
            occurredAt: now,
            payload: {
              event_id: eventId,
              event_type: "ISSUE_PUBLISHED",
              schema_version: 1,
              occurred_at: now.toISOString(),
              aggregate_type: "ISSUE_VERSION",
              aggregate_id: aggregateId,
              data: {
                issue_id: issueId,
                issue_version: ISSUE_VERSION,
                source: "MEMBER_CREATION",
                content_hash: contentHash,
              },
            },
          });

          return {
            issue: {
              id: issueId,
              version: ISSUE_VERSION,
              question: normalized.question,
              context: normalized.context,
              choices: [
                { code: "A", label: normalized.choiceA },
                { code: "B", label: normalized.choiceB },
              ],
              interestCardCode: normalized.interestCardCode,
              publishedAt: now.toISOString(),
            },
            created: true,
          };
        },
        { isolationLevel: "serializable" },
      );
    },
  };
}

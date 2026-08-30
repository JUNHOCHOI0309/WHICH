import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueAuthors,
  issueChoiceMedia,
  issueChoices,
  issueInterestCards,
  issueMediaAssets,
  issueMediaLibraryAssets,
  issueMediaLibraryPairs,
  issueMediaLibraryUsages,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  memberModerationNotices,
  moderationAuditEvents,
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
import { createModerationSubmissionEvents } from "../moderation-dispatch/contracts.js";
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

export function normalizeCommand(command: CreateMemberIssueCommand) {
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
  const libraryPairId = command.libraryPairId ?? null;
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
  if (libraryPairId && (mediaAssetAId || mediaAssetBId)) {
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_MEDIA_INVALID",
      422,
      "Library 이미지와 직접 업로드 이미지는 한 질문에서 함께 사용할 수 없어요.",
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
    libraryPairId,
    interestCardCode: command.interestCardCode,
  };
}

async function requirePublishedLibraryPair(
  database: Pick<Database["db"], "select">,
  pairId: string,
) {
  const now = new Date();
  const rows = await database
    .select({
      pair: issueMediaLibraryPairs,
      libraryAsset: issueMediaLibraryAssets,
      mediaAsset: issueMediaAssets,
    })
    .from(issueMediaLibraryPairs)
    .innerJoin(
      issueMediaLibraryAssets,
      eq(issueMediaLibraryAssets.pairId, issueMediaLibraryPairs.id),
    )
    .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaLibraryAssets.mediaAssetId))
    .where(eq(issueMediaLibraryPairs.id, pairId));
  const sides = rows
    .map((row) => row.libraryAsset.side)
    .sort()
    .join("");
  if (
    rows.length !== 2 ||
    sides !== "AB" ||
    rows.some(
      ({ pair, libraryAsset, mediaAsset }) =>
        pair.status !== "PUBLISHED" ||
        (libraryAsset.expiresAt !== null && libraryAsset.expiresAt <= now) ||
        mediaAsset.processingState !== "READY" ||
        mediaAsset.moderationState !== "APPROVED" ||
        mediaAsset.storageState !== "PUBLISHED" ||
        !["ASSERTED", "CLEARED"].includes(mediaAsset.rightsState),
    )
  ) {
    throw new IssueWriteError(
      "ISSUE_LIBRARY_PAIR_UNAVAILABLE",
      422,
      "선택한 Library 이미지 쌍이 만료·회수되었거나 현재 게시할 수 없는 상태예요.",
    );
  }
  return rows.sort((left, right) => left.libraryAsset.side.localeCompare(right.libraryAsset.side));
}

export async function requireActiveMember(
  database: Pick<Database["db"], "select">,
  sessionToken: string,
) {
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

export function toSubmission(
  row: typeof memberIssueSubmissions.$inferSelect,
): MemberIssueSubmission {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status as MemberIssueSubmission["status"],
    publishedIssueId: row.publishedIssueId,
    publicationState: row.publishedIssueId
      ? "PUBLISHED"
      : row.status === "APPROVED"
        ? "PROCESSING"
        : row.status === "PENDING"
          ? "PROCESSING"
          : (row.status as "NEEDS_CHANGES" | "REJECTED" | "CANCELLED"),
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

export async function requireIssueQuota(
  transaction: Pick<Database["db"], "execute">,
  memberId: string,
) {
  const result = await transaction.execute(sql`
    select (
      (select count(*) from member_issue_submissions s where s.member_id = ${memberId}::uuid and s.created_at > now() - interval '24 hours') +
      (select count(*) from issue_authors a where a.member_id = ${memberId}::uuid and a.assigned_at > now() - interval '24 hours'
        and not exists (select 1 from member_issue_submissions s where s.published_issue_id = a.issue_id))
    )::int as count
  `);
  if (Number(result.rows[0]?.count ?? 0) >= DAILY_CREATION_LIMIT) {
    throw new IssueWriteError(
      "ISSUE_CREATION_LIMIT_REACHED",
      429,
      "질문은 24시간 동안 최대 3개까지 만들 수 있어요.",
    );
  }
}

type SubmissionRow = typeof memberIssueSubmissions.$inferSelect;
type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

async function submissionView(
  database: Pick<Database["db"], "select">,
  row: SubmissionRow,
): Promise<MemberIssueSubmission> {
  const view = toSubmission(row);
  if (row.status === "CANCELLED") return view;
  const ids = [row.mediaAssetAId, row.mediaAssetBId].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return view;
  const assets = await database
    .select()
    .from(issueMediaAssets)
    .where(inArray(issueMediaAssets.id, ids));
  if (
    assets.length !== ids.length ||
    assets.some((asset) => asset.moderationState === "REJECTED" || asset.storageState === "PURGED")
  )
    view.publicationState = "REJECTED";
  else if (
    assets.some(
      (asset) =>
        asset.storageState === "QUARANTINED" ||
        !["ASSERTED", "CLEARED"].includes(asset.rightsState),
    )
  )
    view.publicationState = "QUARANTINED";
  return view;
}

async function recordSubmissionTransition(
  transaction: Transaction,
  row: SubmissionRow,
  action: string,
  memberId?: string,
) {
  const summary =
    row.status === "CANCELLED"
      ? "질문 제출을 취소했어요."
      : row.status === "NEEDS_CHANGES"
        ? "게시 전에 질문 내용을 수정해 주세요."
        : "질문이 게시되었어요.";
  await transaction.insert(memberModerationNotices).values({
    memberId: row.memberId,
    targetType: "ISSUE_VERSION",
    targetId: row.publishedIssueId ?? row.id,
    policyVersion: "issue-submission-flow-v1",
    reasonCode: action,
    actionType:
      row.status === "CANCELLED"
        ? "SUBMISSION_CANCELLED"
        : row.status === "NEEDS_CHANGES"
          ? "SUBMISSION_NEEDS_CHANGES"
          : "ISSUE_PUBLISHED",
    summary,
    nextStep: row.publishedIssueId
      ? "내 질문에서 게시된 질문을 확인할 수 있어요."
      : "작성 내용과 검수 이력은 보존되며 공개되지 않아요.",
    effectiveAt: new Date(),
  });
  await transaction.insert(moderationAuditEvents).values({
    eventType: "ISSUE_SUBMISSION_TRANSITION",
    entityType: "TARGET",
    entityId: row.id,
    actorType: memberId ? "MEMBER" : "SYSTEM",
    actorMemberId: memberId ?? null,
    metadata: { action, revision: row.revision, publishedIssueId: row.publishedIssueId },
  });
}

// Reuse only human-approved, public assets. Shadow findings never grant publication authority.
async function publishReviewedSubmission(
  transaction: Transaction,
  current: SubmissionRow,
): Promise<SubmissionRow> {
  if (
    current.status !== "PENDING" ||
    current.publishedIssueId ||
    !current.mediaAssetAId ||
    !current.mediaAssetBId
  )
    return current;
  const [member] = await transaction
    .select({ status: members.status })
    .from(members)
    .where(eq(members.id, current.memberId));
  if (member?.status !== "ACTIVE") return current;
  const assets = await transaction
    .select()
    .from(issueMediaAssets)
    .where(inArray(issueMediaAssets.id, [current.mediaAssetAId, current.mediaAssetBId]))
    .orderBy(issueMediaAssets.id)
    .for("update");
  if (
    assets.length !== 2 ||
    assets.some(
      (asset) =>
        asset.uploadedByMemberId !== current.memberId ||
        asset.sourceType !== "MEMBER_SUBMISSION" ||
        asset.processingState !== "READY" ||
        asset.moderationState !== "APPROVED" ||
        asset.storageState !== "PUBLISHED" ||
        !asset.publishedObjectKey ||
        !["ASSERTED", "CLEARED"].includes(asset.rightsState),
    )
  )
    return current;
  let normalized: ReturnType<typeof normalizeCommand>;
  try {
    normalized = normalizeCommand({
      ...current,
      sessionToken: "",
      interestCardCode: current.interestCardCode as InterestCardCode,
    });
  } catch (error) {
    if (!(error instanceof IssueWriteError)) throw error;
    const [updated] = await transaction
      .update(memberIssueSubmissions)
      .set({
        status: "NEEDS_CHANGES",
        reviewNote: error.message,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(memberIssueSubmissions.id, current.id))
      .returning();
    await recordSubmissionTransition(transaction, updated!, "TEXT_POLICY_RECHECK");
    return updated!;
  }
  const ordered = [
    assets.find((asset) => asset.id === current.mediaAssetAId)!,
    assets.find((asset) => asset.id === current.mediaAssetBId)!,
  ];
  const result = await publishMemberIssue(
    transaction,
    current.memberId,
    current.id,
    normalized,
    ordered,
    current.id,
  );
  const [updated] = await transaction
    .update(memberIssueSubmissions)
    .set({
      status: "APPROVED",
      publishedIssueId: result.issue.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(memberIssueSubmissions.id, current.id))
    .returning();
  await recordSubmissionTransition(transaction, updated!, "REVIEWED_MEDIA_PUBLISHED");
  return updated!;
}

export async function reconcileReviewedIssueSubmissions(database: Database["db"], assetId: string) {
  const rows = await database
    .select({ id: memberIssueSubmissions.id })
    .from(memberIssueSubmissions)
    .where(
      and(
        eq(memberIssueSubmissions.status, "PENDING"),
        or(
          eq(memberIssueSubmissions.mediaAssetAId, assetId),
          eq(memberIssueSubmissions.mediaAssetBId, assetId),
        ),
      ),
    );
  for (const row of rows) {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${row.id}`}, 0))`,
      );
      const [current] = await transaction
        .select()
        .from(memberIssueSubmissions)
        .where(eq(memberIssueSubmissions.id, row.id))
        .for("update");
      if (current) await publishReviewedSubmission(transaction, current);
    });
  }
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
      if (command.libraryPairId) {
        throw new IssueWriteError(
          "ISSUE_SUBMISSION_MEDIA_INVALID",
          422,
          "Library 이미지는 별도 검수 없이 즉시 게시 경로로 사용해 주세요.",
        );
      }
      const normalized = normalizeCommand(command);
      const session = await requireActiveMember(database, command.sessionToken);
      const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
      const submissionId = deterministicUuid(
        `${session.memberId}:${command.idempotencyKey}:submission`,
      );

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue:${session.memberId}`}, 0))`,
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

        await requireIssueQuota(transaction, session.memberId);

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
        const moderationEvents = createModerationSubmissionEvents({
          targetType: "ISSUE_VERSION",
          targetId: submissionId,
          targetVersion: 1,
          privateObjectReference: `issue-submission://revision/${submissionId}/1`,
          normalizedInputHash: contentHash,
          reason: "CREATE",
        });
        await transaction.insert(outboxEvents).values(moderationEvents.rows);
        return { submission: toSubmission(created!), created: true };
      });
    },

    async resubmitMemberIssue(command: ResubmitMemberIssueCommand) {
      if (command.libraryPairId) {
        throw new IssueWriteError(
          "ISSUE_SUBMISSION_MEDIA_INVALID",
          422,
          "Library 이미지는 별도 검수 없이 즉시 게시 경로로 사용해 주세요.",
        );
      }
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
        if (current.publishedIssueId || !["NEEDS_CHANGES", "PENDING"].includes(current.status)) {
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_EDITABLE",
            409,
            "처리 중이거나 수정이 필요한 비공개 질문만 다시 제출할 수 있어요.",
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
        const moderationEvents = createModerationSubmissionEvents({
          targetType: "ISSUE_VERSION",
          targetId: current.id,
          targetVersion: revision,
          privateObjectReference: `issue-submission://revision/${current.id}/${revision}`,
          normalizedInputHash: contentHash,
          reason: "EDIT",
          occurredAt: now,
        });
        await transaction.insert(outboxEvents).values(moderationEvents.rows);
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
      return { items: await Promise.all(rows.map((row) => submissionView(database, row))) };
    },

    async actOnMemberIssueSubmission(command) {
      const session = await requireActiveMember(database, command.sessionToken);
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${command.submissionId}`}, 0))`,
        );
        const [current] = await transaction
          .select()
          .from(memberIssueSubmissions)
          .where(
            and(
              eq(memberIssueSubmissions.id, command.submissionId),
              eq(memberIssueSubmissions.memberId, session.memberId),
            ),
          )
          .for("update");
        if (!current)
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_FOUND",
            404,
            "제출한 질문을 찾지 못했어요.",
          );
        if (
          (command.action === "CANCEL" && current.status === "CANCELLED") ||
          (command.action !== "CANCEL" && current.publishedIssueId)
        ) {
          return { submission: await submissionView(transaction, current), created: false };
        }
        if (current.revision !== command.expectedRevision)
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_REVISION_CONFLICT",
            409,
            "질문이 변경되었어요. 최신 상태를 다시 확인해 주세요.",
          );
        if (current.publishedIssueId || !["PENDING", "NEEDS_CHANGES"].includes(current.status))
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_EDITABLE",
            409,
            "처리 중인 비공개 질문에서만 사용할 수 있어요.",
          );
        if (command.action === "CHECK") {
          const updated = await publishReviewedSubmission(transaction, current);
          return { submission: await submissionView(transaction, updated), created: false };
        }
        const now = new Date();
        const revision = current.revision + 1;
        let publishedIssueId: string | null = null;
        let contentHash = current.contentHash;
        if (command.action !== "CANCEL") {
          if (command.action === "LIBRARY" && !command.libraryPairId)
            throw new IssueWriteError(
              "ISSUE_LIBRARY_PAIR_UNAVAILABLE",
              422,
              "승인된 Library 이미지 쌍을 선택해 주세요.",
            );
          const normalized = normalizeCommand({
            ...current,
            sessionToken: command.sessionToken,
            idempotencyKey: current.id,
            mediaAssetAId: null,
            mediaAssetBId: null,
            interestCardCode: current.interestCardCode as InterestCardCode,
            libraryPairId: command.action === "LIBRARY" ? command.libraryPairId : null,
          });
          contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
          const result = await publishMemberIssue(
            transaction,
            session.memberId,
            current.id,
            normalized,
            [],
            current.id,
          );
          publishedIssueId = result.issue.id;
        }
        const [updated] = await transaction
          .update(memberIssueSubmissions)
          .set({
            revision,
            status: command.action === "CANCEL" ? "CANCELLED" : "APPROVED",
            publishedIssueId,
            contentHash,
            mediaAssetAId: command.action === "CANCEL" ? current.mediaAssetAId : null,
            mediaAssetBId: command.action === "CANCEL" ? current.mediaAssetBId : null,
            reviewNote: null,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(memberIssueSubmissions.id, current.id))
          .returning();
        await transaction.insert(memberIssueSubmissionRevisions).values({
          submissionId: current.id,
          memberId: session.memberId,
          revision,
          idempotencyKey: randomUUID(),
          question: current.question,
          context: current.context,
          choiceA: current.choiceA,
          choiceB: current.choiceB,
          mediaAssetAId: updated!.mediaAssetAId,
          mediaAssetBId: updated!.mediaAssetBId,
          interestCardCode: current.interestCardCode,
          contentHash,
        });
        await recordSubmissionTransition(transaction, updated!, command.action, session.memberId);
        return { submission: await submissionView(transaction, updated!), created: true };
      });
    },

    async createMemberIssue(command): Promise<CreatedMemberIssue> {
      const normalized = normalizeCommand(command);
      if (normalized.mediaAssetAId || normalized.mediaAssetBId) {
        throw new IssueWriteError(
          "ISSUE_SUBMISSION_MEDIA_INVALID",
          422,
          "직접 업로드 이미지는 안전 검사 경로로 제출해 주세요.",
        );
      }
      return database.transaction(async (transaction) => {
        const session = await requireActiveMember(transaction, command.sessionToken);
        const result = await publishMemberIssue(
          transaction,
          session.memberId,
          command.idempotencyKey,
          normalized,
        );
        const recordId = deterministicUuid(
          `${session.memberId}:${command.idempotencyKey}:publication-record`,
        );
        const recordKey = deterministicUuid(`${recordId}:request`);
        const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
        const submittedAt = new Date(result.issue.publishedAt);
        const content = {
          question: normalized.question,
          context: normalized.context,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          mediaAssetAId: null,
          mediaAssetBId: null,
          interestCardCode: normalized.interestCardCode,
        };
        const [record] = await transaction
          .insert(memberIssueSubmissions)
          .values({
            id: recordId,
            memberId: session.memberId,
            idempotencyKey: recordKey,
            status: "APPROVED",
            publishedIssueId: result.issue.id,
            ...content,
            contentHash,
            submittedAt,
            reviewedAt: submittedAt,
            createdAt: submittedAt,
            updatedAt: submittedAt,
          })
          .onConflictDoNothing()
          .returning();
        if (record) {
          await transaction.insert(memberIssueSubmissionRevisions).values({
            submissionId: record.id,
            memberId: session.memberId,
            revision: 1,
            idempotencyKey: recordKey,
            ...content,
            contentHash,
            submittedAt,
          });
          if (result.created)
            await recordSubmissionTransition(
              transaction,
              record,
              "IMMEDIATE_PUBLISHED",
              session.memberId,
            );
        }
        return result;
      });
    },
  };
}

export async function publishMemberIssue(
  transaction: Parameters<Parameters<Database["db"]["transaction"]>[0]>[0],
  memberId: string,
  idempotencyKey: string,
  normalized: ReturnType<typeof normalizeCommand>,
  directAssets: Array<typeof issueMediaAssets.$inferSelect> = [],
  reservedSubmissionId?: string,
): Promise<CreatedMemberIssue> {
  const now = new Date();
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue:${memberId}`}, 0))`,
  );

  const libraryRows = normalized.libraryPairId
    ? await requirePublishedLibraryPair(transaction, normalized.libraryPairId)
    : [];

  const issueId = deterministicUuid(`${memberId}:${idempotencyKey}:issue`);
  const choiceAId = deterministicUuid(`${memberId}:${idempotencyKey}:choice:a`);
  const choiceBId = deterministicUuid(`${memberId}:${idempotencyKey}:choice:b`);
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
    .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, ISSUE_VERSION)))
    .limit(1);

  if (existing) {
    const [existingLibrary] = await transaction
      .select({ pairId: issueMediaLibraryUsages.pairId })
      .from(issueMediaLibraryUsages)
      .where(eq(issueMediaLibraryUsages.issueId, issueId))
      .limit(1);
    if (
      existing.memberId !== memberId ||
      existing.contentHash !== contentHash ||
      existing.interestCardCode !== normalized.interestCardCode ||
      (existingLibrary?.pairId ?? null) !== normalized.libraryPairId
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

  if (!reservedSubmissionId) await requireIssueQuota(transaction, memberId);

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
    mediaMode:
      libraryRows.length === 2 || directAssets.length === 2 ? "OPTION_IMAGES" : "TEXT_ONLY",
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
  if (libraryRows.length === 2) {
    const choiceBySide = { A: choices[0]!, B: choices[1]! };
    await transaction.insert(issueChoiceMedia).values(
      libraryRows.map(({ libraryAsset, mediaAsset }) => {
        const side = libraryAsset.side as "A" | "B";
        return {
          issueId,
          issueVersion: ISSUE_VERSION,
          choiceId: choiceBySide[side].id,
          mediaAssetId: mediaAsset.id,
          altText: libraryAsset.altText,
          cropMode: libraryAsset.cropMode,
          displayPosition: side === "A" ? 0 : 1,
          linkedByMemberId: memberId,
        };
      }),
    );
    await transaction.insert(issueMediaLibraryUsages).values(
      libraryRows.map(({ libraryAsset }) => {
        const side = libraryAsset.side as "A" | "B";
        return {
          pairId: normalized.libraryPairId!,
          libraryAssetId: libraryAsset.id,
          issueId,
          issueVersion: ISSUE_VERSION,
          choiceId: choiceBySide[side].id,
          side,
          selectedByMemberId: memberId,
        };
      }),
    );
  }
  if (directAssets.length === 2) {
    await transaction.insert(issueChoiceMedia).values(
      directAssets.map((asset, index) => ({
        issueId,
        issueVersion: ISSUE_VERSION,
        choiceId: choices[index]!.id,
        mediaAssetId: asset.id,
        altText: choices[index]!.label,
        cropMode: "CONTAIN" as const,
        displayPosition: index,
        linkedByMemberId: memberId,
      })),
    );
  }
  const sealedSnapshot = await sealIssueVersionSnapshot(transaction, issueId, ISSUE_VERSION);
  const moderationEvents = createModerationSubmissionEvents({
    targetType: "ISSUE_VERSION",
    targetId: issueId,
    targetVersion: ISSUE_VERSION,
    privateObjectReference: `issue://version/${issueId}/${ISSUE_VERSION}`,
    normalizedInputHash: sealedSnapshot.inputHash,
    reason: "CREATE",
    occurredAt: now,
  });
  await transaction.insert(outboxEvents).values(moderationEvents.rows);
  await transaction.insert(issueInterestCards).values({
    issueId,
    issueVersion: ISSUE_VERSION,
    cardCode: normalized.interestCardCode,
    taxonomyVersion: INTEREST_TAXONOMY_VERSION,
    weight: 100,
  });
  await transaction.insert(issueAuthors).values({
    issueId,
    memberId: memberId,
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
        source: normalized.libraryPairId ? "MEMBER_LIBRARY_CREATION" : "MEMBER_CREATION",
        content_hash: contentHash,
        library_pair_id: normalized.libraryPairId,
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
}

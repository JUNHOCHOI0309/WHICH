import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueAuthors,
  issueChoiceMedia,
  issueChoiceMediaRevisions,
  issueChoices,
  issueContextMedia,
  issueInterestCards,
  issueMediaAssets,
  issueMediaAssetVersions,
  issueMediaLibraryAssets,
  issueMediaLibraryPairs,
  issueMediaLibraryUsages,
  issueMediaReviewDecisions,
  issueMediaRightsRequests,
  issueMediaUploadSessions,
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
import { submissionWakeup } from "../moderation-dispatch/submission-wakeup-event.js";
import { IssueWriteError } from "./errors.js";
import { readMemberIssueAccess } from "./member-issue-access.js";
import type { IssueMediaObjectStorage } from "../issue-media/contracts.js";

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
  const choiceC = command.choiceC ? normalizeInline(command.choiceC) : null;
  const choiceD = command.choiceD ? normalizeInline(command.choiceD) : null;
  const choices = [choiceA, choiceB, choiceC, choiceD].filter((choice): choice is string =>
    Boolean(choice),
  );

  if (question && !/[?？]$/u.test(question)) question = `${question}?`;

  if (
    invalidLength(question, 5, 120) ||
    (context !== null && invalidLength(context, 1, 240)) ||
    invalidLength(choiceA, 1, 50) ||
    invalidLength(choiceB, 1, 50) ||
    (choiceC !== null && invalidLength(choiceC, 1, 50)) ||
    (choiceD !== null && invalidLength(choiceD, 1, 50)) ||
    (choiceD !== null && choiceC === null) ||
    new Set(choices.map((choice) => choice.toLocaleLowerCase("ko"))).size !== choices.length ||
    !INTEREST_CARD_CODES.includes(command.interestCardCode)
  ) {
    throw new IssueWriteError(
      "INVALID_ISSUE_CONTENT",
      422,
      "질문, 설명, 2~4개 선택지와 관심 주제를 다시 확인해 주세요.",
    );
  }

  const mediaAssetAId = command.mediaAssetAId ?? null;
  const mediaAssetBId = command.mediaAssetBId ?? null;
  const mediaAssetCId = command.mediaAssetCId ?? null;
  const mediaAssetDId = command.mediaAssetDId ?? null;
  const contextMediaAssetId = command.contextMediaAssetId ?? null;
  const libraryPairId = command.libraryPairId ?? null;
  const libraryAssetIds = command.libraryAssetIds ?? [];
  const optionAssetIds = [mediaAssetAId, mediaAssetBId, mediaAssetCId, mediaAssetDId];
  const activeOptionAssetIds = optionAssetIds.slice(0, choices.length);
  const hasOptionImages = activeOptionAssetIds.some(Boolean);
  if (
    (hasOptionImages && activeOptionAssetIds.some((id) => !id)) ||
    optionAssetIds.slice(choices.length).some(Boolean) ||
    new Set(activeOptionAssetIds.filter(Boolean)).size !==
      activeOptionAssetIds.filter(Boolean).length ||
    (contextMediaAssetId !== null && activeOptionAssetIds.includes(contextMediaAssetId))
  ) {
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_MEDIA_INVALID",
      422,
      "선택지 이미지는 사용 중인 모든 선택지에 함께 등록하고 서로 다른 이미지를 사용해 주세요.",
    );
  }
  if (
    (libraryPairId && choices.length !== 2) ||
    (libraryAssetIds.length > 0 && libraryAssetIds.length !== choices.length) ||
    new Set(libraryAssetIds).size !== libraryAssetIds.length ||
    (libraryPairId && libraryAssetIds.length > 0) ||
    ((libraryPairId || libraryAssetIds.length > 0) && (hasOptionImages || contextMediaAssetId))
  ) {
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_MEDIA_INVALID",
      422,
      "Library 이미지는 선택지 수만큼 고르고 직접 업로드 이미지와 함께 사용할 수 없어요.",
    );
  }

  const combined = [question, context, ...choices].filter(Boolean).join(" ");
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
    choiceC,
    choiceD,
    contextMediaAssetId,
    mediaAssetAId,
    mediaAssetBId,
    mediaAssetCId,
    mediaAssetDId,
    libraryPairId,
    libraryAssetIds,
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

async function requirePublishedLibraryAssets(
  database: Pick<Database["db"], "select">,
  libraryAssetIds: string[],
) {
  const now = new Date();
  const rows = await database
    .select({
      pair: issueMediaLibraryPairs,
      libraryAsset: issueMediaLibraryAssets,
      mediaAsset: issueMediaAssets,
    })
    .from(issueMediaLibraryAssets)
    .innerJoin(
      issueMediaLibraryPairs,
      eq(issueMediaLibraryPairs.id, issueMediaLibraryAssets.pairId),
    )
    .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaLibraryAssets.mediaAssetId))
    .where(inArray(issueMediaLibraryAssets.id, libraryAssetIds));
  const byId = new Map(rows.map((row) => [row.libraryAsset.id, row]));
  const ordered = libraryAssetIds.map((id) => byId.get(id));
  if (
    ordered.some(
      (row) =>
        !row ||
        row.pair.status !== "PUBLISHED" ||
        (row.libraryAsset.expiresAt !== null && row.libraryAsset.expiresAt <= now) ||
        row.mediaAsset.processingState !== "READY" ||
        row.mediaAsset.moderationState !== "APPROVED" ||
        row.mediaAsset.storageState !== "PUBLISHED" ||
        !["ASSERTED", "CLEARED"].includes(row.mediaAsset.rightsState) ||
        !row.mediaAsset.publishedObjectKey,
    )
  ) {
    throw new IssueWriteError(
      "ISSUE_LIBRARY_ASSET_UNAVAILABLE",
      422,
      "선택한 Library 이미지가 만료·회수되었거나 현재 게시할 수 없는 상태예요.",
    );
  }
  return ordered as Array<NonNullable<(typeof ordered)[number]>>;
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
    publicationState:
      row.status === "CANCELLED"
        ? "CANCELLED"
        : row.publishedIssueId
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
    choiceC: row.choiceC,
    choiceD: row.choiceD,
    contextMediaAssetId: row.contextMediaAssetId,
    mediaAssetAId: row.mediaAssetAId,
    mediaAssetBId: row.mediaAssetBId,
    mediaAssetCId: row.mediaAssetCId,
    mediaAssetDId: row.mediaAssetDId,
    interestCardCode: row.interestCardCode as InterestCardCode,
    reviewNote: row.reviewNote,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SubmissionRow = typeof memberIssueSubmissions.$inferSelect;
type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

async function submissionView(
  database: Pick<Database["db"], "select">,
  row: SubmissionRow,
): Promise<MemberIssueSubmission> {
  const view = toSubmission(row);
  if (row.status === "CANCELLED") return view;
  const ids = [
    row.contextMediaAssetId,
    row.mediaAssetAId,
    row.mediaAssetBId,
    row.mediaAssetCId,
    row.mediaAssetDId,
  ].filter((id): id is string => Boolean(id));
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

export async function recordSubmissionTransition(
  transaction: Transaction,
  row: SubmissionRow,
  action: string,
  memberId?: string,
) {
  const removedPublishedIssue =
    action === "PUBLISHED_ISSUE_REMOVED" && Boolean(row.publishedIssueId);
  const summary = removedPublishedIssue
    ? "게시된 질문을 삭제했어요."
    : row.status === "CANCELLED"
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
    actionType: removedPublishedIssue
      ? "PUBLISHED_ISSUE_REMOVED"
      : row.status === "CANCELLED"
        ? "SUBMISSION_CANCELLED"
        : row.status === "NEEDS_CHANGES"
          ? "SUBMISSION_NEEDS_CHANGES"
          : "ISSUE_PUBLISHED",
    summary,
    nextStep: removedPublishedIssue
      ? "공개 노출과 추가 투표는 중단됐으며 기존 참여 기록은 보존돼요."
      : row.publishedIssueId
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

// Callers must establish separate human or explicit Member automation authority first.
// A provider SHADOW result alone is never authorization.
export async function publishReviewedSubmission(
  transaction: Transaction,
  current: SubmissionRow,
  action = "REVIEWED_MEDIA_PUBLISHED",
): Promise<SubmissionRow> {
  const requestedAssetIds = [
    current.contextMediaAssetId,
    current.mediaAssetAId,
    current.mediaAssetBId,
    current.mediaAssetCId,
    current.mediaAssetDId,
  ].filter((id): id is string => Boolean(id));
  if (current.status !== "PENDING" || current.publishedIssueId || requestedAssetIds.length === 0)
    return current;
  const [member] = await transaction
    .select({ status: members.status })
    .from(members)
    .where(eq(members.id, current.memberId));
  if (member?.status !== "ACTIVE") return current;
  const assets = await transaction
    .select()
    .from(issueMediaAssets)
    .where(inArray(issueMediaAssets.id, requestedAssetIds))
    .orderBy(issueMediaAssets.id)
    .for("update");
  if (
    assets.length !== requestedAssetIds.length ||
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
  const result = await publishMemberIssue(
    transaction,
    current.memberId,
    current.id,
    normalized,
    assets,
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
  await recordSubmissionTransition(transaction, updated!, action);
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
          eq(memberIssueSubmissions.mediaAssetCId, assetId),
          eq(memberIssueSubmissions.mediaAssetDId, assetId),
          eq(memberIssueSubmissions.contextMediaAssetId, assetId),
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
        stagingObjectKey: issueMediaAssets.stagingObjectKey,
        publishedObjectKey: issueMediaAssets.publishedObjectKey,
      })
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (
      !asset ||
      asset.uploadedByMemberId !== memberId ||
      asset.sourceType !== "MEMBER_SUBMISSION" ||
      asset.processingState !== "READY" ||
      !["ASSERTED", "CLEARED"].includes(asset.rightsState) ||
      !(
        (asset.moderationState === "PENDING" &&
          asset.storageState === "STAGED" &&
          Boolean(asset.stagingObjectKey)) ||
        (asset.moderationState === "APPROVED" &&
          asset.storageState === "PUBLISHED" &&
          Boolean(asset.publishedObjectKey))
      )
    ) {
      throw new IssueWriteError(
        "ISSUE_SUBMISSION_MEDIA_INVALID",
        422,
        "선택지 이미지가 현재 계정의 검수 가능 상태인지 확인해 주세요.",
      );
    }
  }
}

const submissionAssetColumns = (row: {
  contextMediaAssetId: string | null;
  mediaAssetAId: string | null;
  mediaAssetBId: string | null;
  mediaAssetCId: string | null;
  mediaAssetDId: string | null;
}) =>
  [
    row.contextMediaAssetId,
    row.mediaAssetAId,
    row.mediaAssetBId,
    row.mediaAssetCId,
    row.mediaAssetDId,
  ].filter((id): id is string => Boolean(id));

async function isAssetReferencedByOtherContent(
  transaction: Transaction,
  assetId: string,
  submissionId: string,
) {
  const [otherSubmission] = await transaction
    .select({ id: memberIssueSubmissions.id })
    .from(memberIssueSubmissions)
    .where(
      and(
        ne(memberIssueSubmissions.id, submissionId),
        or(
          eq(memberIssueSubmissions.contextMediaAssetId, assetId),
          eq(memberIssueSubmissions.mediaAssetAId, assetId),
          eq(memberIssueSubmissions.mediaAssetBId, assetId),
          eq(memberIssueSubmissions.mediaAssetCId, assetId),
          eq(memberIssueSubmissions.mediaAssetDId, assetId),
        ),
      ),
    )
    .limit(1);
  if (otherSubmission) return true;
  const [otherRevision] = await transaction
    .select({ id: memberIssueSubmissionRevisions.id })
    .from(memberIssueSubmissionRevisions)
    .where(
      and(
        ne(memberIssueSubmissionRevisions.submissionId, submissionId),
        or(
          eq(memberIssueSubmissionRevisions.contextMediaAssetId, assetId),
          eq(memberIssueSubmissionRevisions.mediaAssetAId, assetId),
          eq(memberIssueSubmissionRevisions.mediaAssetBId, assetId),
          eq(memberIssueSubmissionRevisions.mediaAssetCId, assetId),
          eq(memberIssueSubmissionRevisions.mediaAssetDId, assetId),
        ),
      ),
    )
    .limit(1);
  if (otherRevision) return true;
  const [choiceLink] = await transaction
    .select({ id: issueChoiceMedia.mediaAssetId })
    .from(issueChoiceMedia)
    .where(eq(issueChoiceMedia.mediaAssetId, assetId))
    .limit(1);
  if (choiceLink) return true;
  const [contextLink] = await transaction
    .select({ id: issueContextMedia.mediaAssetId })
    .from(issueContextMedia)
    .where(eq(issueContextMedia.mediaAssetId, assetId))
    .limit(1);
  if (contextLink) return true;
  const [libraryLink] = await transaction
    .select({ id: issueMediaLibraryAssets.id })
    .from(issueMediaLibraryAssets)
    .where(eq(issueMediaLibraryAssets.mediaAssetId, assetId))
    .limit(1);
  if (libraryLink) return true;
  const [publishedRevision] = await transaction
    .select({ id: issueChoiceMediaRevisions.issueId })
    .from(issueChoiceMediaRevisions)
    .where(eq(issueChoiceMediaRevisions.mediaAssetId, assetId))
    .limit(1);
  return Boolean(publishedRevision);
}

async function hardDeleteFailedSubmission(
  transaction: Transaction,
  current: SubmissionRow,
  storage: IssueMediaObjectStorage | null,
) {
  const revisions = await transaction
    .select({
      contextMediaAssetId: memberIssueSubmissionRevisions.contextMediaAssetId,
      mediaAssetAId: memberIssueSubmissionRevisions.mediaAssetAId,
      mediaAssetBId: memberIssueSubmissionRevisions.mediaAssetBId,
      mediaAssetCId: memberIssueSubmissionRevisions.mediaAssetCId,
      mediaAssetDId: memberIssueSubmissionRevisions.mediaAssetDId,
    })
    .from(memberIssueSubmissionRevisions)
    .where(eq(memberIssueSubmissionRevisions.submissionId, current.id));
  const candidateIds = [
    ...new Set([current, ...revisions].flatMap((row) => submissionAssetColumns(row))),
  ];
  const exclusiveAssets: Array<typeof issueMediaAssets.$inferSelect> = [];
  const sharedObjectKeys = new Set<string>();
  for (const assetId of candidateIds) {
    const [asset] = await transaction
      .select()
      .from(issueMediaAssets)
      .where(
        and(
          eq(issueMediaAssets.id, assetId),
          eq(issueMediaAssets.uploadedByMemberId, current.memberId),
          eq(issueMediaAssets.sourceType, "MEMBER_SUBMISSION"),
        ),
      )
      .for("update");
    if (!asset) continue;
    if (await isAssetReferencedByOtherContent(transaction, assetId, current.id)) {
      for (const key of [
        asset.stagingObjectKey,
        asset.publishedObjectKey,
        asset.quarantinedObjectKey,
      ])
        if (key) sharedObjectKeys.add(key);
    } else {
      exclusiveAssets.push(asset);
    }
  }
  const uploadSessions = await transaction
    .select({ objectKey: issueMediaUploadSessions.objectKey })
    .from(issueMediaUploadSessions)
    .where(eq(issueMediaUploadSessions.submissionId, current.id));
  const objectKeys = [
    ...new Set(
      [
        ...uploadSessions
          .map((row) => row.objectKey)
          .filter((objectKey) => !sharedObjectKeys.has(objectKey)),
        ...exclusiveAssets.flatMap((asset) => [
          asset.stagingObjectKey,
          asset.publishedObjectKey,
          asset.quarantinedObjectKey,
        ]),
      ].filter((key): key is string => Boolean(key)),
    ),
  ];
  if (objectKeys.length > 0) {
    if (!storage)
      throw new IssueWriteError(
        "ISSUE_SUBMISSION_STORAGE_UNAVAILABLE",
        503,
        "이미지 저장소에 연결할 수 없어 삭제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    try {
      await storage.purge(objectKeys);
    } catch {
      throw new IssueWriteError(
        "ISSUE_SUBMISSION_STORAGE_DELETE_FAILED",
        503,
        "이미지를 삭제하지 못해 질문도 삭제하지 않았어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
  await transaction.delete(memberIssueSubmissions).where(eq(memberIssueSubmissions.id, current.id));
  for (const asset of exclusiveAssets) {
    const [reviewDecision] = await transaction
      .select({ id: issueMediaReviewDecisions.id })
      .from(issueMediaReviewDecisions)
      .where(eq(issueMediaReviewDecisions.mediaAssetId, asset.id))
      .limit(1);
    const [rightsRequest] = await transaction
      .select({ id: issueMediaRightsRequests.id })
      .from(issueMediaRightsRequests)
      .where(eq(issueMediaRightsRequests.mediaAssetId, asset.id))
      .limit(1);
    if (reviewDecision || rightsRequest) {
      await transaction
        .update(issueMediaAssets)
        .set({
          storageState: "PURGED",
          stagingObjectKey: null,
          publishedObjectKey: null,
          quarantinedObjectKey: null,
          purgedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issueMediaAssets.id, asset.id));
    } else {
      await transaction
        .delete(issueMediaAssetVersions)
        .where(eq(issueMediaAssetVersions.assetId, asset.id));
      await transaction.delete(issueMediaAssets).where(eq(issueMediaAssets.id, asset.id));
    }
  }
  return {
    submission: toSubmission({
      ...current,
      status: "CANCELLED",
      reviewNote: null,
      updatedAt: new Date(),
    }),
    created: true,
    deleted: true,
  };
}

async function removePublishedIssue(transaction: Transaction, current: SubmissionRow) {
  const issueId = current.publishedIssueId;
  if (!issueId)
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_NOT_DELETABLE",
      409,
      "게시된 질문을 찾지 못했어요.",
    );

  const now = new Date();
  const [removedIssue] = await transaction
    .update(issues)
    .set({
      lifecycle: "RETIRED",
      visibility: "REMOVED",
      participation: "VOTING_CLOSED",
      feedEligibility: "EXCLUDED",
      updatedAt: now,
    })
    .where(eq(issues.id, issueId))
    .returning({ id: issues.id });
  if (!removedIssue)
    throw new IssueWriteError(
      "ISSUE_SUBMISSION_NOT_DELETABLE",
      409,
      "게시된 질문을 찾지 못해 삭제하지 않았어요.",
    );

  const revision = current.revision + 1;
  const [updated] = await transaction
    .update(memberIssueSubmissions)
    .set({
      revision,
      status: "CANCELLED",
      reviewNote: null,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(memberIssueSubmissions.id, current.id))
    .returning();
  if (!updated)
    throw new IssueWriteError("ISSUE_SUBMISSION_NOT_FOUND", 404, "제출한 질문을 찾지 못했어요.");

  await transaction.insert(memberIssueSubmissionRevisions).values({
    submissionId: updated.id,
    memberId: updated.memberId,
    revision,
    idempotencyKey: randomUUID(),
    question: updated.question,
    context: updated.context,
    contextMediaAssetId: updated.contextMediaAssetId,
    choiceA: updated.choiceA,
    choiceB: updated.choiceB,
    choiceC: updated.choiceC,
    choiceD: updated.choiceD,
    mediaAssetAId: updated.mediaAssetAId,
    mediaAssetBId: updated.mediaAssetBId,
    mediaAssetCId: updated.mediaAssetCId,
    mediaAssetDId: updated.mediaAssetDId,
    interestCardCode: updated.interestCardCode,
    contentHash: updated.contentHash,
  });
  await recordSubmissionTransition(
    transaction,
    updated,
    "PUBLISHED_ISSUE_REMOVED",
    current.memberId,
  );
  return {
    submission: await submissionView(transaction, updated),
    created: true,
    deleted: true,
  };
}

export function createIssueWriteService(
  database: Database["db"],
  storage: IssueMediaObjectStorage | null = null,
): IssueWriteService {
  async function requireCreationAccess(reader: Pick<Database["db"], "execute">, memberId: string) {
    const access = await readMemberIssueAccess(reader, memberId);
    if (access.canCreateNow) return;
    const message =
      access.reasonCode === "REPORT_COOLDOWN"
        ? "최근 게시물 신고가 누적되어 새 질문 작성이 72시간 제한되었어요. 기존 질문의 수정이나 삭제는 계속할 수 있어요."
        : "최근 게시물 신고가 누적되어 현재는 24시간에 질문 1개만 작성할 수 있어요.";
    throw new IssueWriteError(
      "ISSUE_CREATION_REPORT_RESTRICTED",
      access.reasonCode === "REPORT_COOLDOWN" ? 403 : 429,
      message,
    );
  }

  return {
    async submitMemberIssue(command) {
      if (command.libraryPairId || command.libraryAssetIds?.length) {
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

        await requireCreationAccess(transaction, session.memberId);
        await requireOwnedSubmissionMedia(transaction, session.memberId, [
          normalized.contextMediaAssetId,
          normalized.mediaAssetAId,
          normalized.mediaAssetBId,
          normalized.mediaAssetCId,
          normalized.mediaAssetDId,
        ]);

        const [created] = await transaction
          .insert(memberIssueSubmissions)
          .values({
            id: submissionId,
            memberId: session.memberId,
            idempotencyKey: command.idempotencyKey,
            question: normalized.question,
            context: normalized.context,
            contextMediaAssetId: normalized.contextMediaAssetId,
            choiceA: normalized.choiceA,
            choiceB: normalized.choiceB,
            choiceC: normalized.choiceC,
            choiceD: normalized.choiceD,
            mediaAssetAId: normalized.mediaAssetAId,
            mediaAssetBId: normalized.mediaAssetBId,
            mediaAssetCId: normalized.mediaAssetCId,
            mediaAssetDId: normalized.mediaAssetDId,
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
          contextMediaAssetId: normalized.contextMediaAssetId,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          choiceC: normalized.choiceC,
          choiceD: normalized.choiceD,
          mediaAssetAId: normalized.mediaAssetAId,
          mediaAssetBId: normalized.mediaAssetBId,
          mediaAssetCId: normalized.mediaAssetCId,
          mediaAssetDId: normalized.mediaAssetDId,
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
        await transaction
          .insert(outboxEvents)
          .values([
            ...moderationEvents.rows,
            ...submissionWakeup(
              submissionId,
              1,
              Boolean(
                normalized.contextMediaAssetId ||
                normalized.mediaAssetAId ||
                normalized.mediaAssetBId ||
                normalized.mediaAssetCId ||
                normalized.mediaAssetDId,
              ),
            ),
          ]);
        return { submission: toSubmission(created!), created: true };
      });
    },

    async resubmitMemberIssue(command: ResubmitMemberIssueCommand) {
      if (command.libraryPairId || command.libraryAssetIds?.length) {
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
          normalized.contextMediaAssetId,
          normalized.mediaAssetAId,
          normalized.mediaAssetBId,
          normalized.mediaAssetCId,
          normalized.mediaAssetDId,
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
            contextMediaAssetId: normalized.contextMediaAssetId,
            choiceA: normalized.choiceA,
            choiceB: normalized.choiceB,
            choiceC: normalized.choiceC,
            choiceD: normalized.choiceD,
            mediaAssetAId: normalized.mediaAssetAId,
            mediaAssetBId: normalized.mediaAssetBId,
            mediaAssetCId: normalized.mediaAssetCId,
            mediaAssetDId: normalized.mediaAssetDId,
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
          contextMediaAssetId: normalized.contextMediaAssetId,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          choiceC: normalized.choiceC,
          choiceD: normalized.choiceD,
          mediaAssetAId: normalized.mediaAssetAId,
          mediaAssetBId: normalized.mediaAssetBId,
          mediaAssetCId: normalized.mediaAssetCId,
          mediaAssetDId: normalized.mediaAssetDId,
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
        await transaction
          .insert(outboxEvents)
          .values([
            ...moderationEvents.rows,
            ...submissionWakeup(
              current.id,
              revision,
              Boolean(
                normalized.contextMediaAssetId ||
                normalized.mediaAssetAId ||
                normalized.mediaAssetBId ||
                normalized.mediaAssetCId ||
                normalized.mediaAssetDId,
              ),
            ),
          ]);
        return { submission: toSubmission(updated!), created: true };
      });
    },

    async listMemberIssueSubmissions(command) {
      const session = await requireActiveMember(database, command.sessionToken);
      const rows = await database
        .select()
        .from(memberIssueSubmissions)
        .where(
          and(
            eq(memberIssueSubmissions.memberId, session.memberId),
            command.submissionId ? eq(memberIssueSubmissions.id, command.submissionId) : undefined,
          ),
        )
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
          (command.action === "DELETE" &&
            current.status === "CANCELLED" &&
            current.publishedIssueId) ||
          (!["CANCEL", "DELETE"].includes(command.action) && current.publishedIssueId)
        ) {
          return {
            submission: await submissionView(transaction, current),
            created: false,
            ...(command.action === "DELETE" ? { deleted: true } : {}),
          };
        }
        if (current.revision !== command.expectedRevision)
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_REVISION_CONFLICT",
            409,
            "질문이 변경되었어요. 최신 상태를 다시 확인해 주세요.",
          );
        if (command.action === "DELETE") {
          if (current.publishedIssueId) return removePublishedIssue(transaction, current);
          const view = await submissionView(transaction, current);
          if (!["NEEDS_CHANGES", "REJECTED", "QUARANTINED"].includes(view.publicationState))
            throw new IssueWriteError(
              "ISSUE_SUBMISSION_NOT_DELETABLE",
              409,
              "게시 실패한 비공개 질문만 완전히 삭제할 수 있어요.",
            );
          return hardDeleteFailedSubmission(transaction, current, storage);
        }
        const allowedStatuses =
          command.action === "CANCEL"
            ? ["PENDING", "NEEDS_CHANGES", "REJECTED"]
            : ["PENDING", "NEEDS_CHANGES"];
        if (current.publishedIssueId || !allowedStatuses.includes(current.status))
          throw new IssueWriteError(
            "ISSUE_SUBMISSION_NOT_EDITABLE",
            409,
            command.action === "CANCEL"
              ? "게시되지 않은 질문만 목록에서 제거할 수 있어요."
              : "처리 중인 비공개 질문에서만 사용할 수 있어요.",
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
          if (
            command.action === "LIBRARY" &&
            !command.libraryPairId &&
            !command.libraryAssetIds?.length
          )
            throw new IssueWriteError(
              "ISSUE_LIBRARY_PAIR_UNAVAILABLE",
              422,
              "선택지 수에 맞는 승인된 Library 이미지를 골라 주세요.",
            );
          const normalized = normalizeCommand({
            ...current,
            sessionToken: command.sessionToken,
            idempotencyKey: current.id,
            mediaAssetAId: null,
            mediaAssetBId: null,
            mediaAssetCId: null,
            mediaAssetDId: null,
            contextMediaAssetId: null,
            interestCardCode: current.interestCardCode as InterestCardCode,
            libraryPairId: command.action === "LIBRARY" ? command.libraryPairId : null,
            libraryAssetIds:
              command.action === "LIBRARY" ? (command.libraryAssetIds ?? null) : null,
          });
          contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
          const result = await publishMemberIssue(
            transaction,
            session.memberId,
            current.id,
            normalized,
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
            mediaAssetCId: command.action === "CANCEL" ? current.mediaAssetCId : null,
            mediaAssetDId: command.action === "CANCEL" ? current.mediaAssetDId : null,
            contextMediaAssetId: command.action === "CANCEL" ? current.contextMediaAssetId : null,
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
          contextMediaAssetId: updated!.contextMediaAssetId,
          choiceA: current.choiceA,
          choiceB: current.choiceB,
          choiceC: current.choiceC,
          choiceD: current.choiceD,
          mediaAssetAId: updated!.mediaAssetAId,
          mediaAssetBId: updated!.mediaAssetBId,
          mediaAssetCId: updated!.mediaAssetCId,
          mediaAssetDId: updated!.mediaAssetDId,
          interestCardCode: current.interestCardCode,
          contentHash,
        });
        await recordSubmissionTransition(transaction, updated!, command.action, session.memberId);
        return { submission: await submissionView(transaction, updated!), created: true };
      });
    },

    async createMemberIssue(command): Promise<CreatedMemberIssue> {
      const normalized = normalizeCommand(command);
      if (
        normalized.contextMediaAssetId ||
        normalized.mediaAssetAId ||
        normalized.mediaAssetBId ||
        normalized.mediaAssetCId ||
        normalized.mediaAssetDId
      ) {
        throw new IssueWriteError(
          "ISSUE_SUBMISSION_MEDIA_INVALID",
          422,
          "직접 업로드 이미지는 안전 검사 경로로 제출해 주세요.",
        );
      }
      return database.transaction(async (transaction) => {
        const session = await requireActiveMember(transaction, command.sessionToken);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue:${session.memberId}`}, 0))`,
        );
        const issueId = deterministicUuid(`${session.memberId}:${command.idempotencyKey}:issue`);
        const [existingIssue] = await transaction
          .select({ memberId: issueAuthors.memberId })
          .from(issueAuthors)
          .where(
            and(eq(issueAuthors.issueId, issueId), eq(issueAuthors.memberId, session.memberId)),
          )
          .limit(1);
        if (!existingIssue) await requireCreationAccess(transaction, session.memberId);
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
          contextMediaAssetId: null,
          choiceA: normalized.choiceA,
          choiceB: normalized.choiceB,
          choiceC: normalized.choiceC,
          choiceD: normalized.choiceD,
          mediaAssetAId: null,
          mediaAssetBId: null,
          mediaAssetCId: null,
          mediaAssetDId: null,
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
): Promise<CreatedMemberIssue> {
  const now = new Date();
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue:${memberId}`}, 0))`,
  );

  const libraryRows = normalized.libraryPairId
    ? await requirePublishedLibraryPair(transaction, normalized.libraryPairId)
    : normalized.libraryAssetIds.length > 0
      ? await requirePublishedLibraryAssets(transaction, normalized.libraryAssetIds)
      : [];

  const issueId = deterministicUuid(`${memberId}:${idempotencyKey}:issue`);
  const codes = ["A", "B", "C", "D"] as const;
  const labels = [normalized.choiceA, normalized.choiceB, normalized.choiceC, normalized.choiceD];
  const choices = codes.flatMap((code, index) => {
    const label = labels[index];
    return label
      ? [
          {
            id: deterministicUuid(`${memberId}:${idempotencyKey}:choice:${code.toLowerCase()}`),
            code,
            label,
          },
        ]
      : [];
  });
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
    const existingLibrary = await transaction
      .select({
        pairId: issueMediaLibraryUsages.pairId,
        libraryAssetId: issueMediaLibraryUsages.libraryAssetId,
        side: issueMediaLibraryUsages.side,
      })
      .from(issueMediaLibraryUsages)
      .where(eq(issueMediaLibraryUsages.issueId, issueId))
      .orderBy(issueMediaLibraryUsages.side);
    const expectedLibraryMatches = normalized.libraryPairId
      ? existingLibrary.length === 2 &&
        existingLibrary.every((usage) => usage.pairId === normalized.libraryPairId)
      : normalized.libraryAssetIds.length > 0
        ? existingLibrary.map((usage) => usage.libraryAssetId).join(":") ===
          normalized.libraryAssetIds.join(":")
        : existingLibrary.length === 0;
    if (
      existing.memberId !== memberId ||
      existing.contentHash !== contentHash ||
      existing.interestCardCode !== normalized.interestCardCode ||
      !expectedLibraryMatches
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
        choices: choices.map(({ code, label }) => ({ code, label })),
        interestCardCode: normalized.interestCardCode,
        publishedAt: existing.publishedAt!.toISOString(),
      },
      created: false,
    };
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
    mediaMode:
      libraryRows.length === choices.length || directAssets.length > 0
        ? "OPTION_IMAGES"
        : "TEXT_ONLY",
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
  if (libraryRows.length === choices.length) {
    await transaction.insert(issueChoiceMedia).values(
      libraryRows.map(({ libraryAsset, mediaAsset }, index) => {
        const choice = choices[index]!;
        return {
          issueId,
          issueVersion: ISSUE_VERSION,
          choiceId: choice.id,
          mediaAssetId: mediaAsset.id,
          altText: libraryAsset.altText,
          cropMode: libraryAsset.cropMode,
          displayPosition: index,
          linkedByMemberId: memberId,
        };
      }),
    );
    await transaction.insert(issueMediaLibraryUsages).values(
      libraryRows.map(({ pair, libraryAsset }, index) => {
        const choice = choices[index]!;
        return {
          pairId: pair.id,
          libraryAssetId: libraryAsset.id,
          issueId,
          issueVersion: ISSUE_VERSION,
          choiceId: choice.id,
          side: choice.code,
          selectedByMemberId: memberId,
        };
      }),
    );
  }
  const assetById = new Map(directAssets.map((asset) => [asset.id, asset]));
  const directChoiceAssetIds = [
    normalized.mediaAssetAId,
    normalized.mediaAssetBId,
    normalized.mediaAssetCId,
    normalized.mediaAssetDId,
  ].slice(0, choices.length);
  if (directChoiceAssetIds.every((assetId) => assetId && assetById.has(assetId))) {
    await transaction.insert(issueChoiceMedia).values(
      directChoiceAssetIds.map((assetId, index) => ({
        issueId,
        issueVersion: ISSUE_VERSION,
        choiceId: choices[index]!.id,
        mediaAssetId: assetId!,
        altText: choices[index]!.label,
        cropMode: "CONTAIN" as const,
        displayPosition: index,
        linkedByMemberId: memberId,
      })),
    );
  }
  if (normalized.contextMediaAssetId && assetById.has(normalized.contextMediaAssetId)) {
    await transaction.insert(issueContextMedia).values({
      issueId,
      issueVersion: ISSUE_VERSION,
      mediaAssetId: normalized.contextMediaAssetId,
      altText: normalized.context || `${normalized.question} 설명 이미지`,
      cropMode: "CONTAIN",
      linkedByMemberId: memberId,
    });
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
    acceptedCCount: 0,
    acceptedDCount: 0,
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
        source:
          normalized.libraryPairId || normalized.libraryAssetIds.length > 0
            ? "MEMBER_LIBRARY_CREATION"
            : "MEMBER_CREATION",
        content_hash: contentHash,
        library_pair_id: normalized.libraryPairId,
        library_asset_ids: normalized.libraryAssetIds,
      },
    },
  });

  return {
    issue: {
      id: issueId,
      version: ISSUE_VERSION,
      question: normalized.question,
      context: normalized.context,
      choices: choices.map(({ code, label }) => ({ code, label })),
      interestCardCode: normalized.interestCardCode,
      publishedAt: now.toISOString(),
    },
    created: true,
  };
}

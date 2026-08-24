import { createHash, randomUUID } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueAuthors,
  issueChoices,
  issueInterestCards,
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
  IssueWriteService,
} from "./contracts.js";
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
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
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

  const combined = [question, context, choiceA, choiceB].filter(Boolean).join(" ");
  if (URL_PATTERN.test(combined) || RESTRICTED_TOPIC_PATTERN.test(combined)) {
    throw new IssueWriteError(
      "UNSAFE_ISSUE_CONTENT",
      422,
      "v1에서는 링크가 없고 정치·고위험 주제가 아닌 일상형 질문만 만들 수 있어요.",
    );
  }

  return { question, context, choiceA, choiceB, interestCardCode: command.interestCardCode };
}

export function createIssueWriteService(database: Database["db"]): IssueWriteService {
  return {
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

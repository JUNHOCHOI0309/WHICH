import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import {
  operatorEditorialCandidates,
  operatorPollCandidates,
} from "../../database/schema/index.js";
import { computeIssueContentHash } from "../issue-publication/content-hash.js";
import { OpsReviewValidationError } from "./contracts.js";
import { POLL_CHANNEL_REGISTER } from "./poll-channels.js";
import { readPollSyncStatus } from "./poll-sync-status.js";

export const POLL_CHANNELS = [
  "진행빵집",
  "뭉케뭉케",
  "궁금해소",
  "만렙백수",
  "그분이 알고싶다",
  "주식초등학교",
  "경제야놀자",
  "가비 걸",
  "짤툰",
  "쩝쩝박사",
  "닥터딩요",
  "캠핑한끼CampingHankki",
] as const;
const channelKey = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.normalize("NFC"));
export const pollRowSchema = z.object({
  channel: text(200),
  channelId: z
    .string()
    .regex(/^UC[\w-]{22}$/)
    .optional(),
  sourceUrl: z.string().url(),
  originalQuestion: text(10000),
  originalChoices: z.array(text(300)).min(2).max(6),
  participationText: z.string().trim().max(100).nullable().optional(),
  observedDate: z.string().date().nullable().optional(),
});
export type PollSource = z.infer<typeof pollRowSchema>;
export const pollDraftSchema = z.object({
  question: text(200),
  context: text(500),
  choices: z
    .array(text(100))
    .min(2)
    .max(4)
    .refine(
      (choices) => new Set(choices.map(channelKey)).size === choices.length,
      "서로 다른 선택지를 입력해 주세요.",
    ),
  interestCardCode: text(64),
});
export type PollDraft = z.infer<typeof pollDraftSchema>;

export function normalizePollRow(input: unknown) {
  const row = pollRowSchema.parse(input);
  const channel = POLL_CHANNELS.find((name) => channelKey(name) === channelKey(row.channel));
  if (!channel) throw new Error("수집 대상 채널이 아닙니다.");
  const url = new URL(row.sourceUrl);
  if (
    url.protocol !== "https:" ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("YouTube 공개 투표 원문 URL이 필요합니다.");
  const postId =
    url.pathname.match(/^\/post\/([A-Za-z0-9_-]{10,100})\/?$/)?.[1] ?? url.searchParams.get("lb");
  if (!postId || !/^[A-Za-z0-9_-]{10,100}$/.test(postId))
    throw new Error("개별 커뮤니티 게시물 URL이 필요합니다.");
  return { ...row, channel, sourceUrl: `https://www.youtube.com/post/${postId}`, postId };
}

type Audit = (input: {
  memberId: string;
  eventType?: string;
  outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
  requestId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;
type Actor = { memberId: string; requestId?: string };

export function createPollCandidateMethods(
  database: Database["db"],
  operator: (memberId: string) => Promise<unknown>,
  audit: Audit,
  catalogId: () => Promise<string>,
  categoryByInterest: Record<string, string>,
) {
  async function allowed(input: Actor, eventType: string) {
    if (await operator(input.memberId)) return true;
    await audit({ ...input, eventType, outcome: "DENIED" });
    return false;
  }
  return {
    async readPollCandidates(input: Actor & { before?: string }) {
      if (!(await allowed(input, "OPS_POLL_READ"))) return null;
      const rows = await database
        .select()
        .from(operatorPollCandidates)
        .where(
          input.before
            ? sql`(${operatorPollCandidates.createdAt}, ${operatorPollCandidates.id}) < (select created_at, id from operator_poll_candidates where id = ${input.before}::uuid)`
            : undefined,
        )
        .orderBy(desc(operatorPollCandidates.createdAt), desc(operatorPollCandidates.id))
        .limit(101);
      const items = rows.slice(0, 100);
      const sync = await readPollSyncStatus(database);
      return {
        items,
        nextCursor: rows.length > 100 ? items.at(-1)!.id : null,
        channels: POLL_CHANNELS,
        channelRegister: POLL_CHANNEL_REGISTER,
        sync,
      };
    },
    async importPollCandidates(input: Actor & { rows: unknown[] }) {
      if (!(await allowed(input, "OPS_POLL_IMPORT"))) return null;
      if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 200)
        throw new OpsReviewValidationError("한 번에 후보 1~200개를 가져올 수 있습니다.");
      let imported = 0,
        updated = 0;
      const errors: Array<{ row: number; message: string }> = [];
      for (const [index, value] of input.rows.entries()) {
        let row: ReturnType<typeof normalizePollRow>;
        try {
          row = normalizePollRow(value);
        } catch {
          errors.push({
            row: index + 1,
            message: "채널명, 개별 투표 URL, 원문 질문과 전체 선택지를 확인해 주세요.",
          });
          continue;
        }
        const sourceKey = createHash("sha256").update(`youtube:${row.postId}`).digest("hex");
        const legacyStatus =
          typeof value === "object" && value !== null && "status" in value ? value.status : null;
        const created = await database
          .insert(operatorPollCandidates)
          .values({
            sourceKey,
            source: row,
            status:
              legacyStatus === "DISMISSED" || legacyStatus === "ADOPTED" ? "DISMISSED" : "NEW",
            importedByMemberId: input.memberId,
          })
          .onConflictDoNothing({ target: operatorPollCandidates.sourceKey })
          .returning({ id: operatorPollCandidates.id });
        if (created.length) imported++;
        else {
          // A refreshed source snapshot must never overwrite an already reviewed draft.
          await database
            .update(operatorPollCandidates)
            .set({ source: row, updatedAt: new Date() })
            .where(eq(operatorPollCandidates.sourceKey, sourceKey));
          updated++;
        }
      }
      await audit({
        memberId: input.memberId,
        requestId: input.requestId,
        eventType: "OPS_POLL_IMPORT",
        outcome: "SUCCEEDED",
        metadata: { imported, updated, rejected: errors.length },
      });
      return { imported, updated, errors };
    },
    async sendPollToReview(input: Actor & { id: string; draft: PollDraft }) {
      if (!(await allowed(input, "OPS_POLL_SEND_REVIEW"))) return null;
      const parsed = pollDraftSchema.safeParse(input.draft);
      if (!parsed.success || !categoryByInterest[parsed.data.interestCardCode])
        throw new OpsReviewValidationError("질문·설명·2~4개 선택지와 관심 주제를 확인해 주세요.");
      const draft = parsed.data;
      const catalog = await catalogId();
      return database
        .transaction(async (tx) => {
          const [poll] = await tx
            .select()
            .from(operatorPollCandidates)
            .where(eq(operatorPollCandidates.id, input.id))
            .for("update");
          if (!poll) throw new OpsReviewValidationError("투표 후보를 찾을 수 없습니다.");
          if (poll.editorialCandidateId)
            return { candidateId: poll.editorialCandidateId, replayed: true };
          if (poll.status !== "NEW")
            throw new OpsReviewValidationError(
              "제외한 후보는 복원 후 검수함으로 보낼 수 있습니다.",
            );
          const candidateId = `POLL-${poll.sourceKey.slice(0, 20).toUpperCase()}`;
          const choices = draft.choices.map((label, index) => ({
            id: randomUUID(),
            code: (["A", "B", "C", "D"] as const)[index]!,
            label,
          }));
          await tx.insert(operatorEditorialCandidates).values({
            catalogId: catalog,
            candidateId,
            question: draft.question,
            context: draft.context,
            choices,
            categoryCode: categoryByInterest[draft.interestCardCode]!,
            interestCardCode: draft.interestCardCode,
            editorialArea: categoryByInterest[draft.interestCardCode]!,
            inventoryScope: "ACTIVE",
            contentHash: computeIssueContentHash({ ...draft, choices }),
            createdByMemberId: input.memberId,
            source: poll.source,
          });
          await tx
            .update(operatorPollCandidates)
            .set({ status: "REVIEW", editorialCandidateId: candidateId, updatedAt: new Date() })
            .where(eq(operatorPollCandidates.id, poll.id));
          // The database transaction is the handoff boundary: no approval, publication or vote writes.
          return { candidateId, replayed: false };
        })
        .then(async (result) => {
          await audit({
            memberId: input.memberId,
            requestId: input.requestId,
            eventType: "OPS_POLL_SEND_REVIEW",
            outcome: "SUCCEEDED",
            metadata: result,
          });
          return result;
        });
    },
    async setPollCandidateStatus(input: Actor & { id: string; status: "NEW" | "DISMISSED" }) {
      if (!(await allowed(input, "OPS_POLL_STATUS"))) return null;
      const [row] = await database
        .update(operatorPollCandidates)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(operatorPollCandidates.id, input.id),
            sql`${operatorPollCandidates.editorialCandidateId} is null`,
          ),
        )
        .returning();
      if (!row) throw new OpsReviewValidationError("이미 전송되었거나 찾을 수 없는 후보입니다.");
      await audit({
        memberId: input.memberId,
        requestId: input.requestId,
        eventType: "OPS_POLL_STATUS",
        outcome: "SUCCEEDED",
        metadata: { id: input.id, status: input.status },
      });
      return row;
    },
  };
}

export type PollCandidateMethods = ReturnType<typeof createPollCandidateMethods>;

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  memberIssueSubmissions,
  moderationRuns,
  moderationTargets,
  outboxEvents,
  policyJudgeEvaluations,
} from "../../database/schema/index.js";
import { recordSubmissionTransition } from "../issues/creation-service.js";
import { POLICY_JUDGE_PROFILE } from "../policy-judge/contracts.js";
import { SUBMISSION_WAKEUP } from "./submission-wakeup-event.js";
import { policyJudgeReviewNote, safetySignalReviewNote } from "./submission-review-note.js";

const LEASE_MS = 12 * 60_000; // Longer than the Job's 10 minute hard timeout.
const MAX_ATTEMPTS = 5;
type Wakeup = typeof outboxEvents.$inferSelect;
const technicalFailure =
  "자동 검사를 완료하지 못했어요. 잠시 후 수정·이미지 변경으로 다시 제출하거나 이미지 없이 게시해 주세요.";
const localScanIncomplete =
  "이미지 속 문자 검사를 완료하지 못했어요. 더 선명한 이미지로 바꾸거나 이미지 없이 게시해 주세요.";
const localScanPrivacy =
  "이미지에서 개인정보일 수 있는 문자를 확인했어요. 개인정보를 가린 이미지로 바꾸거나 이미지 없이 게시해 주세요.";

export function createSubmissionWakeups(
  database: Database["db"],
  memberIds: string[],
  now = () => new Date(),
) {
  async function needsChanges(
    tx: Parameters<Parameters<Database["db"]["transaction"]>[0]>[0],
    row: typeof memberIssueSubmissions.$inferSelect,
    note: string,
  ) {
    const [updated] = await tx
      .update(memberIssueSubmissions)
      .set({ status: "NEEDS_CHANGES", reviewNote: note, reviewedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(memberIssueSubmissions.id, row.id),
          eq(memberIssueSubmissions.revision, row.revision),
          eq(memberIssueSubmissions.status, "PENDING"),
        ),
      )
      .returning();
    if (updated) await recordSubmissionTransition(tx, updated, "AI_PUBLICATION_NEEDS_CHANGES");
  }

  async function finish(
    event: Wakeup,
    options: { exhausted?: boolean; budgetDeferred?: boolean; publicationRetryable?: boolean } = {},
  ) {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${event.aggregateId}`}, 0))`,
      );
      const [currentEvent] = await tx
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, event.id))
        .for("update");
      if (
        !currentEvent ||
        currentEvent.status !== "PENDING" ||
        currentEvent.claimToken !== event.claimToken
      )
        return;
      const [submission] = await tx
        .select()
        .from(memberIssueSubmissions)
        .where(sql`${memberIssueSubmissions.id}::text = ${event.aggregateId}`)
        .for("update");
      let complete =
        !submission ||
        submission.revision !== event.payload.revision ||
        submission.status !== "PENDING" ||
        Boolean(submission.publishedIssueId);
      let budget = options.budgetDeferred === true;
      if (!complete && submission) {
        const [run] = await tx
          .select({ run: moderationRuns })
          .from(moderationRuns)
          .innerJoin(moderationTargets, eq(moderationRuns.targetId, moderationTargets.id))
          .where(
            and(
              eq(moderationTargets.targetId, submission.id),
              eq(moderationTargets.targetType, "ISSUE_VERSION"),
              eq(moderationTargets.targetVersion, submission.revision),
              eq(moderationRuns.normalizedInputHash, submission.contentHash),
            ),
          )
          .orderBy(desc(moderationRuns.createdAt))
          .limit(1);
        const [judge] = run
          ? await tx
              .select()
              .from(policyJudgeEvaluations)
              .where(
                and(
                  eq(policyJudgeEvaluations.sourceRunId, run.run.id),
                  eq(policyJudgeEvaluations.profile, POLICY_JUDGE_PROFILE),
                ),
              )
              .limit(1)
          : [];
        budget ||= ["DAILY_CALL_CAP_REACHED", "DAILY_COST_CAP_REACHED"].includes(
          String(run?.run.result.reason),
        );
        let note: string | undefined;
        const inputRejected =
          run?.run.status === "SKIPPED" && run.run.result.inputRejected === true;
        if (
          options.exhausted ||
          run?.run.status === "DEAD_LETTERED" ||
          inputRejected ||
          (judge && ["FAILED", "UNKNOWN"].includes(judge.status))
        ) {
          const resultReason =
            typeof run?.run.result.reason === "string" ? run.run.result.reason : "";
          const failure = `${run?.run.errorMessage ?? ""}:${resultReason}`;
          note = failure.includes("LOCAL_SCAN_PII_WITHHELD")
            ? localScanPrivacy
            : failure.includes("LOCAL_SCAN_PARTIAL") ||
                failure.includes("LOCAL_SCAN_UNAVAILABLE") ||
                failure.includes("LOCAL_SCAN_EVIDENCE_UNAVAILABLE")
              ? localScanIncomplete
              : technicalFailure;
        } else if (
          run?.run.status === "SUCCEEDED" &&
          Array.isArray(run.run.result.signals) &&
          run.run.result.signals.some((s: unknown) =>
            Boolean(s && typeof s === "object" && (s as { flagged?: boolean }).flagged),
          )
        )
          note = safetySignalReviewNote(run.run.result.signals);
        else if (
          judge &&
          !["RUNNING", "STALE"].includes(judge.status) &&
          !options.publicationRetryable
        ) {
          note = policyJudgeReviewNote(judge.result.decision);
        }
        if (note) {
          await needsChanges(tx, submission, note);
          complete = true;
        }
      }
      const next = budget
        ? new Date(
            Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), now().getUTCDate() + 1, 0, 1),
          )
        : new Date(now().getTime() + 60_000);
      await tx
        .update(outboxEvents)
        .set({
          status: complete ? "PUBLISHED" : "PENDING",
          publishedAt: complete ? now() : null,
          claimToken: null,
          claimedAt: null,
          availableAt: next,
          attemptCount:
            budget && !complete
              ? Math.max(0, currentEvent.attemptCount - 1)
              : currentEvent.attemptCount,
          lastError: complete ? null : budget ? "DAILY_BUDGET_DEFERRED" : "AWAITING_JOB_RESULT",
        })
        .where(eq(outboxEvents.id, event.id));
    });
  }

  async function claimed() {
    if (!memberIds.length) return [];
    return database
      .select({ event: outboxEvents })
      .from(outboxEvents)
      .innerJoin(
        memberIssueSubmissions,
        sql`${memberIssueSubmissions.id}::text = ${outboxEvents.aggregateId}`,
      )
      .where(
        and(
          eq(outboxEvents.eventType, SUBMISSION_WAKEUP),
          eq(outboxEvents.status, "PENDING"),
          isNotNull(outboxEvents.claimToken),
          gt(outboxEvents.availableAt, now()),
          inArray(memberIssueSubmissions.memberId, memberIds),
        ),
      )
      .then((rows) => rows.map((r) => r.event));
  }

  async function dispatch(startJob: () => Promise<void>) {
    if (!memberIds.length) return { status: "DISABLED" };
    const events = await database.transaction(async (tx) => {
      // Serialize dispatchers across web revisions without holding a DB connection over HTTP.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('which:moderation-wakeup-dispatch:v1', 0))`,
      );
      const [active] = await tx
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, SUBMISSION_WAKEUP),
            eq(outboxEvents.status, "PENDING"),
            isNotNull(outboxEvents.claimToken),
            gt(outboxEvents.availableAt, now()),
          ),
        )
        .limit(1);
      if (active) return [];
      const candidates = await tx
        .select({ event: outboxEvents })
        .from(outboxEvents)
        .innerJoin(
          memberIssueSubmissions,
          sql`${memberIssueSubmissions.id}::text = ${outboxEvents.aggregateId}`,
        )
        .where(
          and(
            eq(outboxEvents.eventType, SUBMISSION_WAKEUP),
            eq(outboxEvents.status, "PENDING"),
            lte(outboxEvents.availableAt, now()),
            inArray(memberIssueSubmissions.memberId, memberIds),
          ),
        )
        .orderBy(asc(outboxEvents.occurredAt))
        .limit(2);
      if (!candidates.length) return [];
      return tx
        .update(outboxEvents)
        .set({
          claimToken: randomUUID(),
          claimedAt: now(),
          availableAt: new Date(now().getTime() + LEASE_MS),
          attemptCount: sql`${outboxEvents.attemptCount} + 1`,
          totalAttemptCount: sql`${outboxEvents.totalAttemptCount} + 1`,
        })
        .where(
          inArray(
            outboxEvents.id,
            candidates.map((r) => r.event.id),
          ),
        )
        .returning();
    });
    if (!events.length) return { status: "IDLE" };
    const live = [];
    for (const event of events) {
      const [s] = await database
        .select()
        .from(memberIssueSubmissions)
        .where(sql`${memberIssueSubmissions.id}::text = ${event.aggregateId}`);
      if (
        !s ||
        s.revision !== event.payload.revision ||
        s.status !== "PENDING" ||
        s.publishedIssueId ||
        event.attemptCount > MAX_ATTEMPTS
      )
        await finish(event, { exhausted: event.attemptCount > MAX_ATTEMPTS });
      else live.push(event);
    }
    if (!live.length) return { status: "SETTLED" };
    try {
      await startJob();
      return { status: "STARTED", count: live.length };
    } catch {
      // An HTTP timeout can mean the Job was accepted. Keep the lease; never launch
      // a second paid job immediately. A worker ack or lease expiry resolves it.
      return { status: "START_UNKNOWN", count: live.length };
    }
  }
  return { dispatch, claimed, finish };
}

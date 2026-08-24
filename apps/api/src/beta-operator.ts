import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { readMeasurementBaseline } from "./analytics-operator.js";
import { getConfig } from "./config.js";
import { createDatabase, type Database } from "./database/client.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const betaPlanSchema = z.object({
  schemaVersion: z.literal(1),
  betaId: z.string().min(1),
  status: z.literal("PLANNED"),
  cohort: z.object({
    targetInvitedUsers: z.number().int().positive(),
    minimumFeedbackResponses: z.number().int().positive(),
  }),
  observation: z.object({
    minimumHours: z.number().int().positive(),
    defaultReviewWindowDays: z.number().int().min(1).max(90),
  }),
  evidenceThresholds: z.object({
    minimumQualifiedSessions: z.number().int().positive(),
    minimumActiveIssues: z.number().int().positive(),
    maximumModerationQueue: z.number().int().nonnegative(),
    maximumOldestModerationCaseHours: z.number().nonnegative(),
    maximumVoteAggregateMismatches: z.number().int().nonnegative(),
    maximumDeadLetters: z.number().int().nonnegative(),
  }),
  decisionPolicy: z.object({
    requireNoOpenReleaseBlockers: z.literal(true),
    requireNoUnrecoveredSev1: z.literal(true),
    requireNoUnrecoveredDataIncident: z.literal(true),
    automatedEvidenceDoesNotMakeFinalDecision: z.literal(true),
  }),
});

const incidentSchema = z.object({
  incidentId: z.string().min(1).max(80),
  severity: z.enum(["SEV_1", "SEV_2", "SEV_3", "SEV_4"]),
  status: z.enum(["OPEN", "RECOVERED"]),
  dataIntegrityImpact: z.boolean(),
  summary: z.string().min(1).max(500),
  occurredAt: z.iso.datetime(),
  recoveredAt: z.iso.datetime().nullable(),
});

const releaseBlockerSchema = z.object({
  code: z.string().min(1).max(80),
  status: z.enum(["OPEN", "RESOLVED"]),
  summary: z.string().min(1).max(500),
});

export const betaOperatorObservationSchema = z.object({
  schemaVersion: z.literal(1),
  betaId: z.string().min(1),
  observationStartedAt: z.iso.datetime(),
  observationEndedAt: z.iso.datetime().nullable(),
  invitedUsers: z.number().int().nonnegative(),
  feedbackResponses: z.number().int().nonnegative(),
  feedbackThemes: z.array(
    z.object({
      theme: z.string().min(1).max(120),
      count: z.number().int().positive(),
      severity: z.enum(["BLOCKING", "MAJOR", "MINOR", "POSITIVE"]),
    }),
  ),
  incidents: z.array(incidentSchema),
  releaseBlockers: z.array(releaseBlockerSchema),
  notes: z.array(z.string().min(1).max(500)),
});

export type BetaOperatorObservation = z.infer<typeof betaOperatorObservationSchema>;
type BetaPlan = z.infer<typeof betaPlanSchema>;

type OperationalSignals = {
  moderation: {
    reportsInWindow: number;
    reportedCommentsInWindow: number;
    currentQueueSize: number;
    oldestQueueCaseHours: number;
    decisionsInWindow: number;
  };
  integrity: {
    acceptedVotes: number;
    reviewVotes: number;
    rejectedDuplicateVotes: number;
    rejectedAbuseVotes: number;
    invalidatedVotes: number;
  };
  reliability: {
    incompleteVoteAttempts: number;
    deadLetters: number;
  };
  identity: {
    newMembers: number;
  };
};

type EvaluationInput = {
  plan: BetaPlan;
  observation: BetaOperatorObservation;
  generatedAt: string;
  measurement: Awaited<ReturnType<typeof readMeasurementBaseline>>;
  operationalSignals: OperationalSignals;
};

function elapsedHours(start: string, end: string) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

export function evaluateLimitedBetaEvidence(input: EvaluationInput) {
  if (input.observation.betaId !== input.plan.betaId) {
    throw new Error("Operator observation betaId does not match the configured beta plan.");
  }
  const observationEnd = input.observation.observationEndedAt ?? input.generatedAt;
  const observationHours = elapsedHours(input.observation.observationStartedAt, observationEnd);
  const blockingReasons: string[] = [];
  const collectingReasons: string[] = [];
  const thresholds = input.plan.evidenceThresholds;
  const openSev1 = input.observation.incidents.filter(
    (incident) => incident.severity === "SEV_1" && incident.status === "OPEN",
  ).length;
  const unrecoveredDataIncidents = input.observation.incidents.filter(
    (incident) => incident.dataIntegrityImpact && incident.status === "OPEN",
  ).length;
  const openReleaseBlockers = input.observation.releaseBlockers.filter(
    (blocker) => blocker.status === "OPEN",
  ).length;

  if (openSev1 > 0) blockingReasons.push("OPEN_SEV_1");
  if (unrecoveredDataIncidents > 0) blockingReasons.push("UNRECOVERED_DATA_INCIDENT");
  if (openReleaseBlockers > 0) blockingReasons.push("OPEN_RELEASE_BLOCKER");
  if (
    input.measurement.reconciliation.voteAggregateProjection.mismatchedIssues >
    thresholds.maximumVoteAggregateMismatches
  ) {
    blockingReasons.push("VOTE_AGGREGATE_MISMATCH");
  }
  if (input.measurement.contentSupply.activeIssues < thresholds.minimumActiveIssues) {
    blockingReasons.push("ACTIVE_ISSUE_POOL_BELOW_CAPACITY");
  }
  if (input.operationalSignals.moderation.currentQueueSize > thresholds.maximumModerationQueue) {
    blockingReasons.push("MODERATION_QUEUE_OVER_CAPACITY");
  }
  if (
    input.operationalSignals.moderation.oldestQueueCaseHours >
    thresholds.maximumOldestModerationCaseHours
  ) {
    blockingReasons.push("MODERATION_QUEUE_TOO_OLD");
  }
  if (input.operationalSignals.reliability.deadLetters > thresholds.maximumDeadLetters) {
    blockingReasons.push("OUTBOX_DEAD_LETTER_PRESENT");
  }
  if (input.measurement.status === "DEGRADED") blockingReasons.push("MEASUREMENT_DEGRADED");

  if (observationHours < input.plan.observation.minimumHours) {
    collectingReasons.push("OBSERVATION_WINDOW_INCOMPLETE");
  }
  if (input.observation.invitedUsers < input.plan.cohort.targetInvitedUsers) {
    collectingReasons.push("INVITED_COHORT_BELOW_TARGET");
  }
  if (input.observation.feedbackResponses < input.plan.cohort.minimumFeedbackResponses) {
    collectingReasons.push("FEEDBACK_SAMPLE_BELOW_TARGET");
  }
  if (input.measurement.funnel.metrics.qualifiedSessions < thresholds.minimumQualifiedSessions) {
    collectingReasons.push("QUALIFIED_SESSION_SAMPLE_BELOW_TARGET");
  }
  if (input.measurement.status === "INSUFFICIENT_DATA") {
    collectingReasons.push("MEASUREMENT_INSUFFICIENT_DATA");
  }

  const evidenceStatus =
    blockingReasons.length > 0
      ? "BLOCKED"
      : collectingReasons.length > 0
        ? "COLLECTING"
        : "READY_FOR_DECISION";

  return {
    schemaVersion: 1 as const,
    betaId: input.plan.betaId,
    evidenceStatus,
    generatedAt: input.generatedAt,
    observation: {
      startedAt: input.observation.observationStartedAt,
      endedAt: observationEnd,
      elapsedHours: observationHours,
      invitedUsers: input.observation.invitedUsers,
      feedbackResponses: input.observation.feedbackResponses,
    },
    reasons: { blocking: blockingReasons, collecting: [...new Set(collectingReasons)] },
    manualEvidence: {
      feedbackThemes: input.observation.feedbackThemes,
      incidents: input.observation.incidents,
      releaseBlockers: input.observation.releaseBlockers,
      notes: input.observation.notes,
    },
    measurement: input.measurement,
    operationalSignals: input.operationalSignals,
    decisionBoundary:
      "READY_FOR_DECISION means the evidence is sufficient for a human Go/No-Go review; it never publishes or approves a release automatically.",
  };
}

export async function readLimitedBetaEvidence(
  database: Database["db"],
  plan: BetaPlan,
  observation: BetaOperatorObservation,
  reviewWindowDays: number,
  now = new Date(),
) {
  if (!Number.isInteger(reviewWindowDays) || reviewWindowDays < 1 || reviewWindowDays > 90) {
    throw new Error("Beta review window must be an integer between 1 and 90 days.");
  }
  const [measurement, moderation, integrity, reliability, identity] = await Promise.all([
    readMeasurementBaseline(database, reviewWindowDays),
    database.execute<{
      reports_in_window: number;
      reported_comments_in_window: number;
      current_queue_size: number;
      oldest_queue_case_hours: number;
      decisions_in_window: number;
    }>(sql`
      select
        (select count(*)::int from comment_reports
          where counted and created_at >= now() - (${reviewWindowDays} * interval '1 day'))
          as reports_in_window,
        (select count(distinct comment_id)::int from comment_reports
          where counted and created_at >= now() - (${reviewWindowDays} * interval '1 day'))
          as reported_comments_in_window,
        (select count(*)::int from comments
          where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW')
          as current_queue_size,
        coalesce((select extract(epoch from (now() - min(updated_at))) / 3600 from comments
          where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW'), 0)::float
          as oldest_queue_case_hours,
        (select count(*)::int from comment_moderation_decisions
          where decided_at >= now() - (${reviewWindowDays} * interval '1 day'))
          as decisions_in_window
    `),
    database.execute<{
      accepted_votes: number;
      review_votes: number;
      rejected_duplicate_votes: number;
      rejected_abuse_votes: number;
      invalidated_votes: number;
    }>(sql`
      select
        count(*) filter (where integrity_state = 'ACCEPTED')::int as accepted_votes,
        count(*) filter (where integrity_state = 'REVIEW')::int as review_votes,
        count(*) filter (where integrity_state = 'REJECTED_DUPLICATE')::int
          as rejected_duplicate_votes,
        count(*) filter (where integrity_state = 'REJECTED_ABUSE')::int as rejected_abuse_votes,
        count(*) filter (where integrity_state = 'INVALIDATED')::int as invalidated_votes
      from votes
      where created_at >= now() - (${reviewWindowDays} * interval '1 day')
        and not is_test_subject
    `),
    database.execute<{ incomplete_vote_attempts: number; dead_letters: number }>(sql`
      select
        (select count(*)::int from vote_attempts
          where received_at >= now() - (${reviewWindowDays} * interval '1 day')
            and completed_at is null
            and received_at < now() - interval '5 minutes') as incomplete_vote_attempts,
        (select count(*)::int from outbox_events where status = 'FAILED') as dead_letters
    `),
    database.execute<{ new_members: number }>(sql`
      select count(*)::int as new_members
      from members
      where created_at >= now() - (${reviewWindowDays} * interval '1 day')
    `),
  ]);

  const moderationRow = moderation.rows[0]!;
  const integrityRow = integrity.rows[0]!;
  const reliabilityRow = reliability.rows[0]!;
  const identityRow = identity.rows[0]!;
  const operationalSignals: OperationalSignals = {
    moderation: {
      reportsInWindow: Number(moderationRow.reports_in_window),
      reportedCommentsInWindow: Number(moderationRow.reported_comments_in_window),
      currentQueueSize: Number(moderationRow.current_queue_size),
      oldestQueueCaseHours: Number(moderationRow.oldest_queue_case_hours),
      decisionsInWindow: Number(moderationRow.decisions_in_window),
    },
    integrity: {
      acceptedVotes: Number(integrityRow.accepted_votes),
      reviewVotes: Number(integrityRow.review_votes),
      rejectedDuplicateVotes: Number(integrityRow.rejected_duplicate_votes),
      rejectedAbuseVotes: Number(integrityRow.rejected_abuse_votes),
      invalidatedVotes: Number(integrityRow.invalidated_votes),
    },
    reliability: {
      incompleteVoteAttempts: Number(reliabilityRow.incomplete_vote_attempts),
      deadLetters: Number(reliabilityRow.dead_letters),
    },
    identity: { newMembers: Number(identityRow.new_members) },
  };
  const report = evaluateLimitedBetaEvidence({
    plan,
    observation,
    generatedAt: now.toISOString(),
    measurement,
    operationalSignals,
  });
  const reportDigest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return { ...report, reportDigest };
}

async function readPlan() {
  const planPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../content/beta/which-52-limited-beta-v1.json",
  );
  return betaPlanSchema.parse(JSON.parse(await readFile(planPath, "utf8")));
}

async function main() {
  const command = process.argv[2];
  if (command !== "review") {
    throw new Error(
      "Usage: beta-operator review <operator-observation.json> [window-days] [output.json]",
    );
  }
  const observationPath = process.argv[3];
  if (!observationPath) throw new Error("An operator observation JSON path is required.");
  const plan = await readPlan();
  const observation = betaOperatorObservationSchema.parse(
    JSON.parse(await readFile(resolve(observationPath), "utf8")),
  );
  const reviewWindowDays = Number.parseInt(
    process.argv[4] ?? String(plan.observation.defaultReviewWindowDays),
    10,
  );
  const database = createDatabase(getConfig().databaseUrl);
  try {
    const report = await readLimitedBetaEvidence(database.db, plan, observation, reviewWindowDays);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const outputPath = process.argv[5];
    if (outputPath) {
      const resolvedOutputPath = resolve(outputPath);
      await mkdir(dirname(resolvedOutputPath), { recursive: true });
      await writeFile(resolvedOutputPath, serialized, "utf8");
    }
    console.log(serialized.trimEnd());
  } finally {
    await database.close();
  }
}

if (
  process.argv[1]?.endsWith("beta-operator.ts") ||
  process.argv[1]?.endsWith("beta-operator.js")
) {
  await main();
}

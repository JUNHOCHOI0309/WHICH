import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  members,
  memberMediaConsents,
  memberCapabilityGrants,
  memberIssueSubmissions,
} from "./database/schema/index.js";
import {
  autoPublicationConfig,
  createAutoPublicationService,
} from "./modules/issue-media/auto-publication.js";
import { withModerationWorkerLock } from "./modules/moderation-dispatch/worker-lock.js";
import { createSubmissionWakeups } from "./modules/moderation-dispatch/submission-wakeups.js";
import { hasClaimedWakeup } from "./modules/moderation-dispatch/submission-wakeup-event.js";
import { POLICY_JUDGE_CONSENT_VERSION } from "./modules/policy-judge/contracts.js";

import { createPolicyJudgeService } from "./modules/policy-judge/service.js";
import { judgeDiagnostic, policyJudgeConfig } from "./modules/policy-judge/contracts.js";

import { createDatabase } from "./database/client.js";
import {
  createLocalEmbeddedTextExtractor,
  localMediaScannerConfig,
} from "./modules/issue-media/local-scan-detector.js";
import { LOCAL_SCAN_VERSION } from "./modules/issue-media/local-scan-contract.js";
import { EMBEDDED_TEXT_VERSION } from "./modules/issue-media/embedded-text.js";
import { readLatestPublicationReadiness } from "./modules/issue-media/publication-readiness-reader.js";
import { moderationDecisionRuntime } from "./modules/moderation/decision-runtime.js";
import {
  createR2IssueMediaStorage,
  issueMediaStorageConfig,
} from "./modules/issue-media/storage.js";
import { createModerationDispatcherService } from "./modules/moderation-dispatch/service.js";
import { createModerationProviderInputResolver } from "./modules/moderation-providers/input-resolver.js";
import { requireCompletePrivateLocalScan } from "./modules/moderation-providers/local-scan-gate.js";
import { createOpenAiModerationAdapter } from "./modules/moderation-providers/openai-moderation-adapter.js";
import {
  createModerationProviderGate,
  moderationProviderRuntimeConfig,
  providerRuntimeDiagnostic,
} from "./modules/moderation-providers/runtime-gate.js";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ISSUE_MEDIA_CONSENT_VERSION: z.string().min(1).max(64).default("which-media-consent-v2"),
  MODERATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  MODERATION_WORKER_LEASE_MS: z.coerce.number().int().min(5_000).default(60_000),
  MODERATION_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  MODERATION_WORKER_RETRY_BASE_MS: z.coerce.number().int().min(100).default(5_000),
  MODERATION_WORKER_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(300_000),
  MODERATION_WORKER_POLL_MS: z.coerce.number().int().min(250).default(2_000),
});

const config = environmentSchema.parse(process.env);
if (config.MODERATION_WORKER_RETRY_MAX_MS < config.MODERATION_WORKER_RETRY_BASE_MS) {
  throw new Error("MODERATION_WORKER_RETRY_MAX_MS must be at least the retry base.");
}

// A cold Cloud Run Job connects to the external DB over VPC/TLS. Keep the web
// pool's short default, but allow this background worker time to connect.
const database = createDatabase(config.DATABASE_URL, { connectionTimeoutMillis: 10_000 });
const publicationEvidence = {
  consentVersion: config.ISSUE_MEDIA_CONSENT_VERSION,
  decisionRuntime: moderationDecisionRuntime(),
};
const providerConfig = moderationProviderRuntimeConfig();
const mediaConfig = issueMediaStorageConfig();
const mediaStorage = mediaConfig ? createR2IssueMediaStorage(mediaConfig) : null;
const scannerConfig = localMediaScannerConfig();
const autoConfig = autoPublicationConfig();
const pilotRuntime = process.env.MODERATION_WORKER_ENABLED === "true";
const submissionWakeupsOnly = process.env.MODERATION_SUBMISSION_WAKEUPS_ONLY === "true";
if (submissionWakeupsOnly && !pilotRuntime)
  throw new Error("SUBMISSION_WAKEUPS_REQUIRE_PILOT_RUNTIME");
if (pilotRuntime && autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS.length === 0)
  throw new Error("MODERATION_WORKER_PILOT_COHORT_REQUIRED");
if (
  scannerConfig.enabled &&
  config.MODERATION_WORKER_LEASE_MS <
    2 * scannerConfig.timeoutMs + 2 * providerConfig.OPENAI_MODERATION_TIMEOUT_MS + 5000
) {
  throw new Error(
    "MODERATION_WORKER_LEASE_MS must cover two local scans, two provider requests, and 5000ms completion margin.",
  );
}
const resolveRawInput = createModerationProviderInputResolver({
  database: database.db,
  storage: mediaStorage,
  extractEmbeddedText: createLocalEmbeddedTextExtractor({
    ...scannerConfig,
    workerUrl: new URL(
      import.meta.url.endsWith(".ts") ? "./local-media-scanner.ts" : "./local-media-scanner.js",
      import.meta.url,
    ),
    execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
  }),
});
async function requirePilotAccess(target: Parameters<typeof resolveRawInput>[0]) {
  if (!pilotRuntime) return;
  if (target.targetType !== "ISSUE_VERSION") throw new Error("PILOT_SUBMISSION_REQUIRED");
  const [row] = await database.db
    .select({ memberId: members.id })
    .from(memberIssueSubmissions)
    .innerJoin(members, eq(members.id, memberIssueSubmissions.memberId))
    .innerJoin(
      memberMediaConsents,
      and(
        eq(memberMediaConsents.memberId, members.id),
        eq(memberMediaConsents.consentVersion, POLICY_JUDGE_CONSENT_VERSION),
        isNull(memberMediaConsents.revokedAt),
      ),
    )
    .innerJoin(
      memberCapabilityGrants,
      and(
        eq(memberCapabilityGrants.memberId, members.id),
        eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
        eq(memberCapabilityGrants.state, "ACTIVE"),
        sql`${memberCapabilityGrants.expiresAt} > now()`,
      ),
    )
    .where(
      and(
        eq(memberIssueSubmissions.id, target.targetId),
        eq(memberIssueSubmissions.revision, target.targetVersion),
        eq(memberIssueSubmissions.contentHash, target.normalizedInputHash),
        eq(memberIssueSubmissions.status, "PENDING"),
        submissionWakeupsOnly
          ? hasClaimedWakeup(memberIssueSubmissions.id, memberIssueSubmissions.revision)
          : undefined,
        isNull(memberIssueSubmissions.publishedIssueId),
        eq(members.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!row || !autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS.includes(row.memberId))
    throw new Error("PILOT_ACCESS_REQUIRED");
}
const resolveProviderInput: typeof resolveRawInput = async (target) => {
  await requirePilotAccess(target);
  const input = await resolveRawInput(target);
  if (pilotRuntime) requireCompletePrivateLocalScan(input);
  await requirePilotAccess(target);
  return input;
};
const adapter =
  providerConfig.MODERATION_PROVIDER === "OPENAI_MODERATION" && providerConfig.OPENAI_API_KEY
    ? createOpenAiModerationAdapter({
        apiKey: providerConfig.OPENAI_API_KEY,
        model: providerConfig.OPENAI_MODERATION_MODEL,
        timeoutMs: providerConfig.OPENAI_MODERATION_TIMEOUT_MS,
        resolveInput: resolveProviderInput,
        embeddedTextEnabled: scannerConfig.enabled,
        cacheProfile: `${EMBEDDED_TEXT_VERSION}:${LOCAL_SCAN_VERSION}:${scannerConfig.enabled ? "LOCAL" : "OFF"}:private-pilot-v1`,
      })
    : null;
const worker = createModerationDispatcherService(database.db, adapter, {
  batchSize: config.MODERATION_WORKER_BATCH_SIZE,
  leaseMilliseconds: config.MODERATION_WORKER_LEASE_MS,
  maxAttempts: config.MODERATION_WORKER_MAX_ATTEMPTS,
  retryBaseMilliseconds: config.MODERATION_WORKER_RETRY_BASE_MS,
  retryMaxMilliseconds: config.MODERATION_WORKER_RETRY_MAX_MS,
  providerGate: createModerationProviderGate({ database: database.db, config: providerConfig }),
  publicationEvidence,
  submissionMemberIds: pilotRuntime
    ? autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS
    : undefined,
  deferProviderGate: true,
  submissionWakeupsOnly,
});

const judgeConfig = policyJudgeConfig();
const policyJudge = createPolicyJudgeService({
  submissionWakeupsOnly,
  database: database.db,
  config: judgeConfig,
  provider: providerConfig,
  resolveInput: resolveProviderInput,
});
const autoPublication = createAutoPublicationService({
  submissionWakeupsOnly,
  database: database.db,
  storage: mediaStorage,
  config: autoConfig,
  judge: policyJudge,
  safetyModel: providerConfig.OPENAI_MODERATION_MODEL,
  resolveInput: resolveProviderInput,
  runtimeAllowed: () =>
    pilotRuntime &&
    scannerConfig.enabled &&
    process.env.ISSUE_MEMBER_MEDIA_UPLOAD_MODE === "PILOT" &&
    process.env.FEATURE_ISSUE_MEDIA_ENABLED === "true" &&
    judgeDiagnostic(judgeConfig, providerConfig).allowed,
});

async function once() {
  return withModerationWorkerLock(database.db, async () => {
    const wakeups = createSubmissionWakeups(
      database.db,
      autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS,
    );
    const requests = submissionWakeupsOnly ? await wakeups.claimed() : [];
    if (submissionWakeupsOnly && !requests.length) return { status: "NO_SUBMISSION_REQUESTS" };
    const dispatched = await worker.dispatchBatch();
    const processed = await worker.processBatch();
    const policyJudgeShadow = await policyJudge.runBatch().catch(() => ({
      status: "ERROR",
      reason: "POLICY_JUDGE_WORKER_FAILED",
      publicationChanged: false,
    }));
    const automaticPublication = await autoPublication.runBatch();
    if (automaticPublication.enabled) {
      const budgetDeferred =
        "processed" in policyJudgeShadow &&
        policyJudgeShadow.processed.some((r) => r.reason === "DAILY_BUDGET_EXHAUSTED");
      const publicationRetryable = automaticPublication.processed.some(
        (result) => "reason" in result && result.reason === "PUBLICATION_FAILED_RETRYABLE",
      );
      for (const request of requests)
        await wakeups.finish(request, { budgetDeferred, publicationRetryable });
    }
    return { dispatched, processed, policyJudgeShadow, automaticPublication };
  });
}

async function main() {
  const command = process.argv[2] ?? "once";
  if (command === "diagnose-runtime") {
    console.log(
      JSON.stringify(
        {
          workerEnabled: pilotRuntime,
          localScannerEnabled: scannerConfig.enabled,
          cohortSize: autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS.length,
          autoPublicationEnabled: autoPublication.enabled(),
          mode: autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MODE,
          judge: judgeDiagnostic(judgeConfig, providerConfig),
          provider: providerRuntimeDiagnostic(providerConfig),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "diagnose-policy-judge") {
    console.log(JSON.stringify(judgeDiagnostic(judgeConfig, providerConfig), null, 2));
    return;
  }
  if (command === "policy-judge-summary") {
    console.log(JSON.stringify(await policyJudge.summary(), null, 2));
    return;
  }
  if (command === "policy-judge-once") {
    console.log(JSON.stringify(await policyJudge.runBatch(), null, 2));
    return;
  }
  if (command === "diagnose-publication") {
    const submissionId = z.uuid().parse(process.argv[3]);
    console.log(
      JSON.stringify(
        await readLatestPublicationReadiness(
          database.db,
          submissionId,
          new Date(),
          publicationEvidence,
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "diagnose-provider") {
    console.log(JSON.stringify(providerRuntimeDiagnostic(providerConfig), null, 2));
    return;
  }
  if (command === "once") {
    console.log(JSON.stringify(await once(), null, 2));
    return;
  }
  if (command === "run") {
    const controller = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => controller.abort());
    while (!controller.signal.aborted) {
      try {
        console.log(JSON.stringify(await once()));
      } catch {
        console.error(JSON.stringify({ status: "ERROR", reason: "MODERATION_BATCH_FAILED" }));
      }
      await wait(config.MODERATION_WORKER_POLL_MS, undefined, { signal: controller.signal }).catch(
        () => {},
      );
    }
    return;
  }
  if (command === "dead-letters") {
    console.log(
      JSON.stringify(await worker.listDeadLetters(Number(process.argv[3]) || 50), null, 2),
    );
    return;
  }
  if (command === "requeue") {
    const runId = process.argv[3];
    if (!runId) throw new Error("Usage: moderation-worker requeue <run-id>");
    console.log(JSON.stringify(await worker.requeueDeadLetter(runId), null, 2));
    return;
  }
  if (command === "reconcile-media") {
    const storageConfig = issueMediaStorageConfig();
    if (!storageConfig) throw new Error("Issue media R2 configuration is incomplete.");
    const storage = createR2IssueMediaStorage(storageConfig);
    console.log(JSON.stringify(await worker.reconcileMedia(storage), null, 2));
    return;
  }
  throw new Error(`Unknown Moderation Worker command: ${command}`);
}

main()
  .catch(() => {
    console.error("MODERATION_WORKER_FAILED");
    process.exitCode = 1;
  })
  .finally(() => database.close());

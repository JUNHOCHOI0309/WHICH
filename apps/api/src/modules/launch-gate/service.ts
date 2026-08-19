import type {
  LaunchGateApiProbe,
  LaunchGateCheck,
  LaunchGateConfig,
  LaunchGateReport,
  LaunchGateStore,
  PublicSurfaceReport,
  PublicWebProbe,
  RollbackSnapshot,
  RollbackVerificationReport,
} from "./contracts.js";

const PLACEHOLDER_PATTERN = /(^local$|replace|changeme|example\.com|which-local|local-internal)/i;

function pass(name: string, summary: string, details?: Record<string, unknown>): LaunchGateCheck {
  return { name, status: "PASS", summary, ...(details ? { details } : {}) };
}

function fail(name: string, summary: string, details?: Record<string, unknown>): LaunchGateCheck {
  return { name, status: "FAIL", summary, ...(details ? { details } : {}) };
}

async function checked(
  name: string,
  operation: () => Promise<LaunchGateCheck>,
): Promise<LaunchGateCheck> {
  try {
    return await operation();
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : "Unknown check failure.");
  }
}

function environmentCheck(config: LaunchGateConfig) {
  const apiUrl = new URL(config.apiBaseUrl);
  const publicWebUrl = new URL(config.publicWebUrl);
  const webhookUrl = config.outboxWebhookUrl ? new URL(config.outboxWebhookUrl) : null;
  const problems: string[] = [];
  const apiIsLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(apiUrl.hostname);

  if (PLACEHOLDER_PATTERN.test(config.expectedReleaseId))
    problems.push("release ID is a placeholder");
  if (PLACEHOLDER_PATTERN.test(config.internalAuthSecret)) {
    problems.push("internal auth secret is a placeholder");
  }
  if (config.outboxDeliveryRequired) {
    if (!config.outboxWebhookSecret) problems.push("Outbox webhook secret is missing");
    else if (PLACEHOLDER_PATTERN.test(config.outboxWebhookSecret)) {
      problems.push("Outbox webhook secret is a placeholder");
    }
    if (!config.outboxWebhookUrl) problems.push("Outbox webhook URL is missing");
    else if (PLACEHOLDER_PATTERN.test(config.outboxWebhookUrl)) {
      problems.push("Outbox webhook URL is a placeholder");
    }
  }
  if (config.targetEnvironment === "production") {
    if (apiUrl.protocol !== "https:" && !(apiIsLoopback && apiUrl.protocol === "http:")) {
      problems.push("production API URL must be HTTPS or an HTTP loopback URL");
    }
    if (publicWebUrl.protocol !== "https:") problems.push("production Web URL is not HTTPS");
    if (config.outboxDeliveryRequired && webhookUrl?.protocol !== "https:") {
      problems.push("production Outbox URL is not HTTPS");
    }
  }

  return problems.length === 0
    ? pass("environment", "Required release values are configured without exposing secrets.", {
        targetEnvironment: config.targetEnvironment,
        apiOrigin: apiUrl.origin,
        publicWebOrigin: publicWebUrl.origin,
        outboxDeliveryMode: config.outboxDeliveryRequired ? "HTTP_REQUIRED" : "DEFERRED",
        outboxOrigin: config.outboxDeliveryRequired ? (webhookUrl?.origin ?? null) : null,
      })
    : fail("environment", "Release configuration is not safe.", { problems });
}

async function collectPublicSurfaceChecks(publicWeb: PublicWebProbe) {
  const checks: LaunchGateCheck[] = [];
  checks.push(
    await checked("public_home", async () => {
      const result = await publicWeb.home();
      return result.statusCode === 200 && result.isHtml
        ? pass("public_home", "Public Web returns an HTML page.")
        : fail("public_home", "Public Web home check failed.", result);
    }),
  );
  checks.push(
    await checked("public_feed", async () => {
      const result = await publicWeb.feed();
      return result.statusCode === 200 && result.itemCount !== null && result.itemCount > 0
        ? pass("public_feed", "Public Feed contains at least one launchable Issue.", result)
        : fail("public_feed", "Public Feed has no launchable Issue.", result);
    }),
  );
  checks.push(
    await checked("google_oauth_start", async () => {
      const result = await publicWeb.googleOAuthStart();
      const redirectStatus = [302, 303, 307, 308].includes(result.statusCode);
      return redirectStatus && result.providerHost === "accounts.google.com"
        ? pass("google_oauth_start", "Google OAuth starts at the expected provider.", result)
        : fail("google_oauth_start", "Google OAuth start check failed.", result);
    }),
  );
  return checks;
}

export async function runPublicSurfaceGate(
  publicWebUrl: string,
  publicWeb: PublicWebProbe,
  now: () => Date = () => new Date(),
): Promise<PublicSurfaceReport> {
  const checks = await collectPublicSurfaceChecks(publicWeb);
  return {
    schemaVersion: 1,
    gate: "PUBLIC_SURFACE_V1",
    publicWebUrl,
    checkedAt: now().toISOString(),
    verdict: checks.every((check) => check.status === "PASS") ? "GO" : "NO_GO",
    checks,
  };
}

export async function runLaunchGate(
  config: LaunchGateConfig,
  dependencies: {
    store: LaunchGateStore;
    api: LaunchGateApiProbe;
    publicWeb: PublicWebProbe;
    now?: () => Date;
  },
): Promise<LaunchGateReport> {
  const checks: LaunchGateCheck[] = [environmentCheck(config)];

  checks.push(
    await checked("database_migrations", async () => {
      const applied = await dependencies.store.readAppliedMigrationTimestamps();
      const expected = config.expectedMigrations.map((migration) => migration.appliedAt);
      const missing = config.expectedMigrations
        .filter((migration) => !applied.includes(migration.appliedAt))
        .map((migration) => migration.tag);
      const unexpected = applied.filter((timestamp) => !expected.includes(timestamp));
      return missing.length === 0 && unexpected.length === 0
        ? pass("database_migrations", `${expected.length} migrations match the release artifact.`, {
            appliedCount: applied.length,
          })
        : fail("database_migrations", "Database migrations do not match the release artifact.", {
            missing,
            unexpectedTimestamps: unexpected,
          });
    }),
  );

  checks.push(
    await checked("api_liveness", async () => {
      const result = await dependencies.api.live();
      return result.statusCode === 200 && result.status === "ok" && result.service === "which-api"
        ? pass("api_liveness", "API process is live.")
        : fail("api_liveness", "API liveness probe failed.", result);
    }),
  );
  checks.push(
    await checked("api_readiness", async () => {
      const result = await dependencies.api.ready();
      return result.statusCode === 200 && result.status === "ok" && result.service === "which-api"
        ? pass("api_readiness", "API and database are ready.")
        : fail("api_readiness", "API readiness probe failed.", result);
    }),
  );
  checks.push(
    await checked("release_identity", async () => {
      const result = await dependencies.api.meta();
      return result.statusCode === 200 &&
        result.service === "which-api" &&
        result.releaseId === config.expectedReleaseId
        ? pass("release_identity", `API reports release ${config.expectedReleaseId}.`, {
            version: result.version,
            featureFlags: result.featureFlags,
          })
        : fail("release_identity", "Running API release does not match the expected release.", {
            statusCode: result.statusCode,
            expectedReleaseId: config.expectedReleaseId,
            actualReleaseId: result.releaseId,
          });
    }),
  );

  checks.push(
    await checked("outbox_health", async () => {
      const health = await dependencies.store.readOutboxHealth();
      const deadLettersOk = health.failed <= config.maxDeadLetters;
      const pendingAgeOk =
        !config.outboxDeliveryRequired ||
        health.oldestPendingAgeSeconds === null ||
        health.oldestPendingAgeSeconds <= config.maxPendingAgeSeconds;
      return deadLettersOk && pendingAgeOk
        ? pass(
            "outbox_health",
            config.outboxDeliveryRequired
              ? "Outbox backlog is within release thresholds."
              : "Outbox delivery is deferred; pending Events remain preserved.",
            {
              ...health,
              deliveryMode: config.outboxDeliveryRequired ? "HTTP_REQUIRED" : "DEFERRED",
            },
          )
        : fail("outbox_health", "Outbox backlog exceeds release thresholds.", {
            ...health,
            maxDeadLetters: config.maxDeadLetters,
            maxPendingAgeSeconds: config.maxPendingAgeSeconds,
          });
    }),
  );

  checks.push(...(await collectPublicSurfaceChecks(dependencies.publicWeb)));

  checks.push(
    await checked("vote_reconciliation", async () => {
      const result = await dependencies.api.reconcile();
      return result.statusCode === 200 &&
        result.mode === "DRY_RUN" &&
        result.status === "CONSISTENT" &&
        result.mismatchCount === 0
        ? pass("vote_reconciliation", "Sample Issue Version is consistent in Dry Run mode.", {
            issueId: config.issueId,
            issueVersion: config.issueVersion,
          })
        : fail("vote_reconciliation", "Vote reconciliation did not return a consistent Dry Run.", {
            ...result,
            issueId: config.issueId,
            issueVersion: config.issueVersion,
          });
    }),
  );

  return {
    schemaVersion: 1,
    gate: "PUBLIC_MVP_V1",
    targetEnvironment: config.targetEnvironment,
    expectedReleaseId: config.expectedReleaseId,
    checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    verdict: checks.every((check) => check.status === "PASS") ? "GO" : "NO_GO",
    checks,
  };
}

export async function createRollbackSnapshot(
  config: LaunchGateConfig,
  rollbackTargetReleaseId: string,
  dependencies: { store: LaunchGateStore; api: LaunchGateApiProbe; now?: () => Date },
): Promise<RollbackSnapshot> {
  if (!rollbackTargetReleaseId || rollbackTargetReleaseId === config.expectedReleaseId) {
    throw new Error("Rollback target release ID must differ from the current release ID.");
  }
  const meta = await dependencies.api.meta();
  if (meta.statusCode !== 200 || meta.releaseId !== config.expectedReleaseId) {
    throw new Error("Running API does not match the source release; snapshot was not created.");
  }
  const database = await dependencies.store.captureRollbackBaseline();
  return {
    schemaVersion: 1,
    snapshotType: "WHICH_ROLLBACK_V1",
    capturedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    sourceReleaseId: config.expectedReleaseId,
    rollbackTargetReleaseId,
    targetEnvironment: config.targetEnvironment,
    database,
  };
}

export async function verifyRollback(
  snapshot: RollbackSnapshot,
  dependencies: {
    store: LaunchGateStore;
    api: LaunchGateApiProbe;
    publicWeb: PublicWebProbe;
    now?: () => Date;
  },
): Promise<RollbackVerificationReport> {
  const checks: LaunchGateCheck[] = [];
  checks.push(
    await checked("api_liveness", async () => {
      const result = await dependencies.api.live();
      return result.statusCode === 200 && result.status === "ok"
        ? pass("api_liveness", "Rolled-back API is live.")
        : fail("api_liveness", "Rolled-back API liveness probe failed.", result);
    }),
  );
  checks.push(
    await checked("api_readiness", async () => {
      const result = await dependencies.api.ready();
      return result.statusCode === 200 && result.status === "ok"
        ? pass("api_readiness", "Rolled-back API is ready.")
        : fail("api_readiness", "Rolled-back API readiness probe failed.", result);
    }),
  );
  checks.push(
    await checked("rollback_release_identity", async () => {
      const result = await dependencies.api.meta();
      return result.statusCode === 200 && result.releaseId === snapshot.rollbackTargetReleaseId
        ? pass(
            "rollback_release_identity",
            `API reports rollback target ${snapshot.rollbackTargetReleaseId}.`,
          )
        : fail("rollback_release_identity", "API is not running the declared rollback target.", {
            expectedReleaseId: snapshot.rollbackTargetReleaseId,
            actualReleaseId: result.releaseId,
          });
    }),
  );
  checks.push(
    await checked("migration_preservation", async () => {
      const applied = await dependencies.store.readAppliedMigrationTimestamps();
      const missing = snapshot.database.appliedMigrationTimestamps.filter(
        (timestamp) => !applied.includes(timestamp),
      );
      return missing.length === 0
        ? pass("migration_preservation", "Rollback did not downgrade the database schema.", {
            snapshotCount: snapshot.database.appliedMigrationTimestamps.length,
            currentCount: applied.length,
          })
        : fail("migration_preservation", "Applied migrations disappeared after rollback.", {
            missingTimestamps: missing,
          });
    }),
  );
  checks.push(
    await checked("protected_fact_preservation", async () => {
      const current = await dependencies.store.readProtectedFacts(snapshot.database.capturedAt);
      const expected = snapshot.database.protectedFacts;
      const votesMatch =
        current.votes.count === expected.votes.count &&
        current.votes.digest === expected.votes.digest;
      const outboxMatch =
        current.outboxEvents.count === expected.outboxEvents.count &&
        current.outboxEvents.digest === expected.outboxEvents.digest;
      return votesMatch && outboxMatch
        ? pass("protected_fact_preservation", "Vote facts and Outbox Events were preserved.", {
            voteFactCount: current.votes.count,
            outboxEventCount: current.outboxEvents.count,
          })
        : fail("protected_fact_preservation", "Protected facts changed after rollback.", {
            expected,
            current,
          });
    }),
  );
  checks.push(
    await checked("outbox_recovery", async () => {
      const current = await dependencies.store.readOutboxHealth();
      return current.failed <= snapshot.database.outbox.failed
        ? pass("outbox_recovery", "Rollback did not add new Outbox Dead Letters.", {
            snapshotFailed: snapshot.database.outbox.failed,
            currentFailed: current.failed,
            currentPending: current.pending,
          })
        : fail("outbox_recovery", "Outbox Dead Letters increased during rollback.", {
            snapshotFailed: snapshot.database.outbox.failed,
            currentFailed: current.failed,
          });
    }),
  );
  checks.push(
    await checked("vote_reconciliation", async () => {
      const result = await dependencies.api.reconcile();
      return result.statusCode === 200 &&
        result.mode === "DRY_RUN" &&
        result.status === "CONSISTENT" &&
        result.mismatchCount === 0
        ? pass("vote_reconciliation", "Vote aggregate remains consistent after rollback.")
        : fail("vote_reconciliation", "Vote reconciliation failed after rollback.", result);
    }),
  );
  checks.push(...(await collectPublicSurfaceChecks(dependencies.publicWeb)));

  return {
    schemaVersion: 1,
    verification: "ROLLBACK_V1",
    checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    sourceReleaseId: snapshot.sourceReleaseId,
    expectedRollbackReleaseId: snapshot.rollbackTargetReleaseId,
    verdict: checks.every((check) => check.status === "PASS") ? "VERIFIED" : "FAILED",
    checks,
  };
}

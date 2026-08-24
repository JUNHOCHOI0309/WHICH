import { describe, expect, it } from "vitest";

import type {
  LaunchGateApiProbe,
  LaunchGateConfig,
  LaunchGateStore,
  PublicWebProbe,
  RollbackSnapshot,
} from "../src/modules/launch-gate/contracts.js";
import { getLaunchGateConfig } from "../src/modules/launch-gate/config.js";
import {
  createRollbackSnapshot,
  runLaunchGate,
  runPublicSurfaceGate,
  verifyRollback,
} from "../src/modules/launch-gate/service.js";

const config: LaunchGateConfig = {
  targetEnvironment: "production",
  apiBaseUrl: "http://127.0.0.1:4000",
  publicWebUrl: "https://which.test",
  expectedReleaseId: "release-2026-08-19.1",
  internalAuthSecret: "safe-production-internal-secret",
  outboxDeliveryRequired: true,
  outboxWebhookUrl: "https://events.which.test/delivery",
  outboxWebhookSecret: "safe-production-webhook-secret",
  issueId: "10000000-0000-4000-8000-000000000001",
  issueVersion: 1,
  maxDeadLetters: 0,
  maxPendingAgeSeconds: 300,
  expectedMigrations: [{ tag: "0000_initial", appliedAt: 1000 }],
};

function createPublicWeb(overrides: Partial<PublicWebProbe> = {}): PublicWebProbe {
  return {
    home: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    feed: () => Promise.resolve({ statusCode: 200, itemCount: 1 }),
    issueDeepLink: () => Promise.resolve({ statusCode: 200, isHtml: true, issueId: "issue-1" }),
    nextIssue: () =>
      Promise.resolve({
        statusCode: 200,
        itemCount: 1,
        excludedIssueId: "issue-1",
        returnedIssueId: "issue-2",
      }),
    mobileFeed: () => Promise.resolve({ statusCode: 200, itemCount: 1 }),
    login: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    signup: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    passwordRecovery: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    memberCenter: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    privacyPolicy: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    termsOfService: () => Promise.resolve({ statusCode: 200, isHtml: true }),
    googleOAuthStart: () =>
      Promise.resolve({ statusCode: 307, providerHost: "accounts.google.com" }),
    xOAuthStart: () => Promise.resolve({ statusCode: 307, providerHost: "x.com" }),
    naverOAuthStart: () => Promise.resolve({ statusCode: 307, providerHost: "nid.naver.com" }),
    kakaoOAuthStart: () => Promise.resolve({ statusCode: 307, providerHost: "kauth.kakao.com" }),
    ...overrides,
  };
}

function createStore(overrides: Partial<LaunchGateStore> = {}): LaunchGateStore {
  return {
    readAppliedMigrationTimestamps: () => Promise.resolve([1000]),
    readOutboxHealth: () =>
      Promise.resolve({
        total: 4,
        pending: 0,
        published: 4,
        failed: 0,
        oldestPendingAgeSeconds: null,
      }),
    captureRollbackBaseline: () =>
      Promise.resolve({
        capturedAt: "2026-08-19T00:00:00.000Z",
        appliedMigrationTimestamps: [1000],
        outbox: {
          total: 4,
          pending: 0,
          published: 4,
          failed: 0,
          oldestPendingAgeSeconds: null,
        },
        protectedFacts: {
          votes: { count: 3, digest: "votes-digest" },
          outboxEvents: { count: 4, digest: "outbox-digest" },
        },
      }),
    readProtectedFacts: () =>
      Promise.resolve({
        votes: { count: 3, digest: "votes-digest" },
        outboxEvents: { count: 4, digest: "outbox-digest" },
      }),
    ...overrides,
  };
}

function createApi(overrides: Partial<LaunchGateApiProbe> = {}): LaunchGateApiProbe {
  return {
    live: () => Promise.resolve({ statusCode: 200, status: "ok", service: "which-api" }),
    ready: () => Promise.resolve({ statusCode: 200, status: "ok", service: "which-api" }),
    meta: () =>
      Promise.resolve({
        statusCode: 200,
        service: "which-api",
        version: "0.1.0",
        releaseId: config.expectedReleaseId,
        featureFlags: { comments: true },
      }),
    reconcile: () =>
      Promise.resolve({
        statusCode: 200,
        mode: "DRY_RUN",
        status: "CONSISTENT",
        mismatchCount: 0,
      }),
    ...overrides,
  };
}

describe("Public MVP Gate", () => {
  it("returns GO only when every required check passes", async () => {
    const report = await runLaunchGate(config, {
      store: createStore(),
      api: createApi(),
      publicWeb: createPublicWeb(),
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    });

    expect(report.verdict).toBe("GO");
    expect(report.checks).toHaveLength(22);
    expect(report.checks.every((check) => check.status === "PASS")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(config.internalAuthSecret);
    expect(JSON.stringify(report)).not.toContain(config.outboxWebhookSecret);
  });

  it("returns NO_GO with concrete migration, Outbox, and reconciliation failures", async () => {
    const report = await runLaunchGate(config, {
      store: createStore({
        readAppliedMigrationTimestamps: () => Promise.resolve([]),
        readOutboxHealth: () =>
          Promise.resolve({
            total: 5,
            pending: 2,
            published: 2,
            failed: 1,
            oldestPendingAgeSeconds: 301,
          }),
      }),
      api: createApi({
        reconcile: () =>
          Promise.resolve({
            statusCode: 200,
            mode: "DRY_RUN",
            status: "MISMATCH_FOUND",
            mismatchCount: 2,
          }),
      }),
      publicWeb: createPublicWeb(),
    });

    expect(report.verdict).toBe("NO_GO");
    expect(
      report.checks.filter((check) => check.status === "FAIL").map((check) => check.name),
    ).toEqual(["database_migrations", "outbox_health", "vote_reconciliation"]);
  });

  it("rejects placeholder and non-HTTPS production configuration", async () => {
    const report = await runLaunchGate(
      {
        ...config,
        apiBaseUrl: "http://localhost:4000",
        publicWebUrl: "http://localhost:3000",
        expectedReleaseId: "local",
        internalAuthSecret: "which-local-internal-auth-secret",
        outboxWebhookUrl: "https://events.example.com/which",
        outboxWebhookSecret: "replace-with-a-secret",
      },
      { store: createStore(), api: createApi(), publicWeb: createPublicWeb() },
    );

    expect(report.verdict).toBe("NO_GO");
    expect(report.checks[0]).toMatchObject({ name: "environment", status: "FAIL" });
  });

  it("allows an explicit deferred Outbox while retaining Dead Letter enforcement", async () => {
    const report = await runLaunchGate(
      {
        ...config,
        outboxDeliveryRequired: false,
        outboxWebhookUrl: null,
        outboxWebhookSecret: null,
      },
      {
        store: createStore({
          readOutboxHealth: () =>
            Promise.resolve({
              total: 10,
              pending: 10,
              published: 0,
              failed: 0,
              oldestPendingAgeSeconds: 86_400,
            }),
        }),
        api: createApi(),
        publicWeb: createPublicWeb(),
      },
    );

    expect(report.verdict).toBe("GO");
    expect(report.checks.find((check) => check.name === "outbox_health")).toMatchObject({
      status: "PASS",
      details: { deliveryMode: "DEFERRED", pending: 10 },
    });
  });

  it("uses Render's immutable commit when an explicit release ID is absent", () => {
    const parsed = getLaunchGateConfig(
      {
        LAUNCH_GATE_TARGET_ENVIRONMENT: "production",
        LAUNCH_GATE_API_URL: "http://127.0.0.1:4000",
        LAUNCH_GATE_PUBLIC_WEB_URL: "https://whichone.site",
        RENDER_GIT_COMMIT: "render-commit-sha",
        INTERNAL_AUTH_SECRET: "safe-production-internal-secret",
        LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED: "false",
        LAUNCH_GATE_ISSUE_ID: config.issueId,
        LAUNCH_GATE_ISSUE_VERSION: "1",
      },
      config.expectedMigrations,
    );

    expect(parsed.expectedReleaseId).toBe("render-commit-sha");
    expect(parsed.outboxDeliveryRequired).toBe(false);
    expect(parsed.outboxWebhookUrl).toBeNull();
  });
});

describe("Public Surface Gate", () => {
  it("returns NO_GO when the deployed Feed has no launchable Issue", async () => {
    const report = await runPublicSurfaceGate(
      "https://whichone.site",
      createPublicWeb({ feed: () => Promise.resolve({ statusCode: 200, itemCount: 0 }) }),
    );

    expect(report.verdict).toBe("NO_GO");
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "public_feed", status: "FAIL" }),
    );
  });

  it("returns NO_GO when a next Issue or required OAuth provider is unavailable", async () => {
    const report = await runPublicSurfaceGate(
      "https://whichone.site",
      createPublicWeb({
        nextIssue: () =>
          Promise.resolve({
            statusCode: 200,
            itemCount: 1,
            excludedIssueId: "issue-1",
            returnedIssueId: "issue-1",
          }),
        kakaoOAuthStart: () => Promise.resolve({ statusCode: 404, providerHost: null }),
      }),
    );

    expect(report.verdict).toBe("NO_GO");
    expect(
      report.checks.filter((check) => check.status === "FAIL").map((check) => check.name),
    ).toEqual(["public_next_issue", "kakao_oauth_start"]);
  });
});

describe("rollback drill", () => {
  it("captures the running source release and protected facts", async () => {
    const snapshot = await createRollbackSnapshot(config, "release-2026-08-18.4", {
      store: createStore(),
      api: createApi(),
      now: () => new Date("2026-08-19T01:00:00.000Z"),
    });

    expect(snapshot.sourceReleaseId).toBe(config.expectedReleaseId);
    expect(snapshot.rollbackTargetReleaseId).toBe("release-2026-08-18.4");
    expect(snapshot.database.protectedFacts.outboxEvents.count).toBe(4);
  });

  it("verifies the rollback target and preserved migrations/facts", async () => {
    const snapshot: RollbackSnapshot = {
      schemaVersion: 1,
      snapshotType: "WHICH_ROLLBACK_V1",
      capturedAt: "2026-08-19T01:00:00.000Z",
      sourceReleaseId: config.expectedReleaseId,
      rollbackTargetReleaseId: "release-2026-08-18.4",
      targetEnvironment: "production",
      database: await createStore().captureRollbackBaseline(),
    };
    const report = await verifyRollback(snapshot, {
      store: createStore(),
      api: createApi({
        meta: () =>
          Promise.resolve({
            statusCode: 200,
            service: "which-api",
            version: "0.1.0",
            releaseId: snapshot.rollbackTargetReleaseId,
            featureFlags: { comments: false },
          }),
      }),
      publicWeb: createPublicWeb(),
    });

    expect(report.verdict).toBe("VERIFIED");
  });

  it("fails when a pre-snapshot Vote fact disappears", async () => {
    const snapshot: RollbackSnapshot = {
      schemaVersion: 1,
      snapshotType: "WHICH_ROLLBACK_V1",
      capturedAt: "2026-08-19T01:00:00.000Z",
      sourceReleaseId: config.expectedReleaseId,
      rollbackTargetReleaseId: "release-2026-08-18.4",
      targetEnvironment: "production",
      database: await createStore().captureRollbackBaseline(),
    };
    const report = await verifyRollback(snapshot, {
      store: createStore({
        readProtectedFacts: () =>
          Promise.resolve({
            votes: { count: 2, digest: "changed" },
            outboxEvents: { count: 4, digest: "outbox-digest" },
          }),
      }),
      api: createApi({
        meta: () =>
          Promise.resolve({
            statusCode: 200,
            service: "which-api",
            version: "0.1.0",
            releaseId: snapshot.rollbackTargetReleaseId,
            featureFlags: null,
          }),
      }),
      publicWeb: createPublicWeb(),
    });

    expect(report.verdict).toBe("FAILED");
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "protected_fact_preservation", status: "FAIL" }),
    );
  });
});

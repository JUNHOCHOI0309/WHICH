import { describe, expect, it } from "vitest";
import {
  defaultRadarActivation,
  evaluateRadarAccess,
  evaluateRadarRequest,
  evaluateRadarStoredUse,
  radarActivationSchema,
  radarBudgetDayKey,
  type RadarActivation,
  type RadarBudgetUsage,
} from "../src/modules/radar/source-policy.js";
import {
  RADAR_CAPABILITIES,
  RADAR_POLICY_VERSION,
  radarDeferredSources,
  radarSourceRegistry,
  type RadarSource,
} from "../src/modules/radar/source-registry.js";

const now = "2026-09-19T12:00:00Z";
// Synthetic approvals only. No provider credentials or live permissions are loaded.
function approved(source: RadarSource = "GOOGLE_TRENDING_RSS"): RadarActivation {
  const activation = defaultRadarActivation(source);
  activation.enabled = true;
  activation.killSwitch = false;
  activation.credentialsVerified = true;
  activation.quotaScopeId = "fixture-project";
  activation.retentionHours = 24;
  for (const capability of RADAR_CAPABILITIES) {
    if (capability === "train") continue;
    activation.rights[capability] = {
      status: "APPROVED",
      evidenceUrl: "https://example.com/fixture-approval",
      reviewedBy: "fixture-reviewer",
      checkedAt: "2026-09-19T00:00:00Z",
      expiresAt: "2026-10-01T00:00:00Z",
    };
  }
  return activation;
}
function usage(
  source: RadarSource = "GOOGLE_TRENDING_RSS",
  operation = "trending.rss",
): RadarBudgetUsage {
  const limits = radarSourceRegistry[source].operations[operation]!;
  return {
    source,
    policyVersion: RADAR_POLICY_VERSION,
    pool: limits.pool,
    quotaScopeId: "fixture-project",
    runId: "fixture-run",
    dayKey: radarBudgetDayKey(now, limits.timeZone),
    runRequests: 0,
    dayRequests: 0,
    runUnits: 0,
    dayUnits: 0,
  };
}
const request = { source: "GOOGLE_TRENDING_RSS", operation: "trending.rss", runId: "fixture-run" };

describe("Radar activation and rights", () => {
  it.each(Object.keys(radarSourceRegistry) as RadarSource[])(
    "starts %s disabled with unknown rights",
    (source) => {
      const policy = defaultRadarActivation(source);
      expect(radarActivationSchema.safeParse(policy).success).toBe(true);
      expect(policy.rights.collect.status).toBe("UNKNOWN");
      expect(policy.retentionHours).toBeNull();
      expect(evaluateRadarAccess(policy, ["collect"], now)).toEqual({
        allowed: false,
        reason: "SOURCE_DISABLED",
      });
    },
  );
  it("does not share mutable approvals between defaults", () => {
    const first = defaultRadarActivation("GOOGLE_TRENDING_RSS");
    first.rights.collect.status = "APPROVED";
    expect(first.rights.store.status).toBe("UNKNOWN");
    expect(defaultRadarActivation("GOOGLE_TRENDING_RSS").rights.collect.status).toBe("UNKNOWN");
  });
  it("does not treat enabling a source as permission", () => {
    const policy = defaultRadarActivation("GOOGLE_TRENDING_RSS");
    policy.enabled = true;
    policy.killSwitch = false;
    expect(evaluateRadarRequest(policy, request, usage(), now)).toEqual({
      allowed: false,
      reason: "RIGHT_COLLECT_UNKNOWN",
    });
  });
  it("rejects alpha even if someone supplies approved configuration", () => {
    expect(radarDeferredSources[0].enabled).toBe(false);
    expect(
      evaluateRadarAccess({ ...approved(), source: "GOOGLE_TRENDS_ALPHA" }, ["collect"], now)
        .allowed,
    ).toBe(false);
  });
  it("requires verified credentials for authenticated APIs", () => {
    expect(
      evaluateRadarAccess(
        { ...approved("YOUTUBE_DATA_API"), credentialsVerified: false },
        ["collect"],
        now,
      ),
    ).toEqual({ allowed: false, reason: "CREDENTIALS_UNVERIFIED" });
  });
  it.each(["UNKNOWN", "DENIED"] as const)("rejects %s rights", (status) => {
    const policy = approved();
    policy.rights.store.status = status;
    expect(evaluateRadarRequest(policy, request, usage(), now).allowed).toBe(false);
  });
  it.each([
    { evidenceUrl: null },
    { reviewedBy: null },
    { checkedAt: null },
    { expiresAt: null },
    { checkedAt: "2026-09-20T00:00:00Z" },
    { expiresAt: now },
    { expiresAt: "2026-09-18T00:00:00Z" },
    { evidenceUrl: "http://example.com" },
  ])("rejects incomplete/future/expired grant %j", (override) => {
    const policy = approved();
    Object.assign(policy.rights.collect, override);
    expect(evaluateRadarRequest(policy, request, usage(), now).allowed).toBe(false);
  });
  it("separates collection from redistribution, derivation and inference", () => {
    const policy = approved();
    for (const capability of ["redisplay", "derive", "inference"] as const) {
      policy.rights[capability].status = "UNKNOWN";
      expect(evaluateRadarStoredUse(policy, capability, now, now).allowed).toBe(false);
    }
    expect(evaluateRadarRequest(policy, request, usage(), now).allowed).toBe(true);
  });
  it("cannot enable training just by changing approval status", () => {
    const policy = approved();
    policy.rights.train = { ...policy.rights.collect };
    expect(evaluateRadarAccess(policy, ["train"], now)).toEqual({
      allowed: false,
      reason: "TRAINING_DISABLED",
    });
  });
  it("honors kill switch and internal policy review expiry", () => {
    expect(evaluateRadarAccess({ ...approved(), killSwitch: true }, ["collect"], now).allowed).toBe(
      false,
    );
    expect(evaluateRadarAccess(approved(), ["collect"], "2026-10-19T00:00:00Z")).toEqual({
      allowed: false,
      reason: "POLICY_REVIEW_EXPIRED",
    });
  });
  it("rejects invalid input and stale policy versions", () => {
    expect(evaluateRadarAccess(approved(), [], now).allowed).toBe(false);
    expect(evaluateRadarAccess(approved(), ["collect"], "not-a-time").allowed).toBe(false);
    expect(
      evaluateRadarAccess({ ...approved(), policyVersion: "old" }, ["collect"], now).allowed,
    ).toBe(false);
  });
});

describe("Radar budget preflight", () => {
  it("allows the last available request, without mutating or claiming a reservation", () => {
    const used = { ...usage(), dayRequests: 143, dayUnits: 143 };
    const snapshot = structuredClone(used);
    expect(evaluateRadarRequest(approved(), request, used, now)).toEqual({ allowed: true });
    expect(used).toEqual(snapshot);
  });
  it.each([
    ["runRequests", 1, "RUN_BUDGET_EXHAUSTED"],
    ["runUnits", 1, "RUN_BUDGET_EXHAUSTED"],
    ["dayRequests", 144, "DAY_BUDGET_EXHAUSTED"],
    ["dayUnits", 144, "DAY_BUDGET_EXHAUSTED"],
  ])("rejects exhausted %s", (field, value, reason) => {
    expect(evaluateRadarRequest(approved(), request, { ...usage(), [field]: value }, now)).toEqual({
      allowed: false,
      reason,
    });
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid counters %s",
    (value) => {
      expect(
        evaluateRadarRequest(approved(), request, { ...usage(), dayRequests: value }, now).allowed,
      ).toBe(false);
    },
  );
  it.each([
    { source: "NAVER_SEARCH" },
    { quotaScopeId: "other-project" },
    { pool: "other-pool" },
    { runId: "other-run" },
    { dayKey: "2026-09-18" },
    { policyVersion: "old" },
  ])("rejects mismatched ledger context %j", (override) => {
    expect(
      evaluateRadarRequest(approved(), request, { ...usage(), ...override }, now).allowed,
    ).toBe(false);
  });
  it.each(["unknown", "toString", "__proto__", "videos.insert"])(
    "rejects unregistered operation %s",
    (operation) => {
      expect(evaluateRadarRequest(approved(), { ...request, operation }, usage(), now)).toEqual({
        allowed: false,
        reason: "OPERATION_UNREGISTERED",
      });
    },
  );
  it("shares YouTube metadata pool but not the search pool", () => {
    const policy = approved("YOUTUBE_DATA_API");
    const req = { ...request, source: policy.source, operation: "channels.list" };
    const used = { ...usage(policy.source, "videos.list"), dayUnits: 500 };
    expect(evaluateRadarRequest(policy, req, used, now)).toEqual({
      allowed: false,
      reason: "DAY_BUDGET_EXHAUSTED",
    });
    expect(evaluateRadarRequest(policy, { ...req, operation: "search.list" }, used, now)).toEqual({
      allowed: false,
      reason: "BUDGET_SCOPE_MISMATCH",
    });
    expect(
      evaluateRadarRequest(
        policy,
        { ...req, operation: "search.list" },
        usage(policy.source, "search.list"),
        now,
      ).allowed,
    ).toBe(true);
  });
  it.each(Object.keys(radarSourceRegistry) as RadarSource[])(
    "accepts registered %s operations with synthetic approval",
    (source) => {
      for (const operation of Object.keys(radarSourceRegistry[source].operations)) {
        expect(
          evaluateRadarRequest(
            approved(source),
            { ...request, source, operation },
            usage(source, operation),
            now,
          ).allowed,
        ).toBe(true);
      }
    },
  );
  it("uses Pacific midnight with DST and a separate Korean local day", () => {
    expect(radarBudgetDayKey("2026-09-19T06:59:59Z", "America/Los_Angeles")).toBe("2026-09-18");
    expect(radarBudgetDayKey("2026-09-19T07:00:00Z", "America/Los_Angeles")).toBe("2026-09-19");
    expect(radarBudgetDayKey("2026-12-19T07:59:59Z", "America/Los_Angeles")).toBe("2026-12-18");
    expect(radarBudgetDayKey("2026-09-19T15:00:00Z", "Asia/Seoul")).toBe("2026-09-20");
  });
});

describe("Radar retention gate", () => {
  it("requires confirmed retention, and rejects longer storage even with a grant", () => {
    expect(
      evaluateRadarRequest({ ...approved(), retentionHours: null }, request, usage(), now),
    ).toEqual({ allowed: false, reason: "RETENTION_UNCONFIRMED" });
    expect(
      evaluateRadarRequest({ ...approved(), retentionHours: 720 }, request, usage(), now).allowed,
    ).toBe(false);
  });
  it("expires at TTL boundary and never extends TTL on reads", () => {
    expect(
      evaluateRadarStoredUse(approved(), "redisplay", "2026-09-18T12:00:01Z", now).allowed,
    ).toBe(true);
    expect(evaluateRadarStoredUse(approved(), "redisplay", "2026-09-18T12:00:00Z", now)).toEqual({
      allowed: false,
      reason: "DATA_EXPIRED",
    });
    expect(
      evaluateRadarStoredUse(
        { ...approved(), retentionHours: 1 },
        "derive",
        "2026-09-19T11:00:00Z",
        now,
      ).allowed,
    ).toBe(false);
  });
  it.each(["invalid", "2026-09-20T00:00:00Z"])("rejects fetchedAt %s", (fetchedAt) => {
    expect(evaluateRadarStoredUse(approved(), "redisplay", fetchedAt, now).allowed).toBe(false);
  });
});

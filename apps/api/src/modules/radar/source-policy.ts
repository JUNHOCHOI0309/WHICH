import { z } from "zod";
import { radarSourceSchema } from "./contracts.js";
import {
  RADAR_CAPABILITIES,
  RADAR_POLICY_REVIEW_DUE,
  RADAR_POLICY_VERSION,
  radarSourceRegistry,
  type RadarCapability,
  type RadarSource,
} from "./source-registry.js";

const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().trim().min(1).max(200);
const evidenceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
const grant = z.strictObject({
  status: z.enum(["UNKNOWN", "APPROVED", "DENIED"]),
  evidenceUrl: evidenceUrl.nullable(),
  reviewedBy: identifier.nullable(),
  checkedAt: timestamp.nullable(),
  expiresAt: timestamp.nullable(),
});

export const radarActivationSchema = z.strictObject({
  source: radarSourceSchema,
  policyVersion: z.literal(RADAR_POLICY_VERSION),
  enabled: z.boolean(),
  killSwitch: z.boolean(),
  // Non-secret identifier for the credential/project whose shared ledger is used.
  quotaScopeId: identifier,
  credentialsVerified: z.boolean(),
  rights: z.strictObject({
    collect: grant,
    store: grant,
    redisplay: grant,
    derive: grant,
    inference: grant,
    train: grant,
  }),
  retentionHours: z.number().int().positive().max(24).nullable(),
});
export type RadarActivation = z.infer<typeof radarActivationSchema>;

export function defaultRadarActivation(source: RadarSource): RadarActivation {
  const unknown = () => ({
    status: "UNKNOWN" as const,
    evidenceUrl: null,
    reviewedBy: null,
    checkedAt: null,
    expiresAt: null,
  });
  return {
    source,
    policyVersion: RADAR_POLICY_VERSION,
    enabled: false,
    killSwitch: true,
    quotaScopeId: "unconfigured",
    credentialsVerified: false,
    retentionHours: null,
    rights: {
      collect: unknown(),
      store: unknown(),
      redisplay: unknown(),
      derive: unknown(),
      inference: unknown(),
      train: { ...unknown(), status: "DENIED" },
    },
  };
}

type Decision = { allowed: true } | { allowed: false; reason: string };
const deny = (reason: string): Decision => ({ allowed: false, reason });

/** Pure preflight only. Load activation from trusted server configuration, never a request body. */
export function evaluateRadarAccess(
  activation: unknown,
  capabilities: readonly RadarCapability[],
  now: string,
): Decision {
  const parsed = radarActivationSchema.safeParse(activation);
  if (
    !parsed.success ||
    !timestamp.safeParse(now).success ||
    capabilities.length === 0 ||
    capabilities.some((capability) => !RADAR_CAPABILITIES.includes(capability))
  ) {
    return deny("INVALID_POLICY_INPUT");
  }
  const policy = parsed.data;
  if (!policy.enabled || policy.killSwitch) return deny("SOURCE_DISABLED");
  const nowMs = Date.parse(now);
  if (nowMs >= Date.parse(RADAR_POLICY_REVIEW_DUE)) return deny("POLICY_REVIEW_EXPIRED");
  if (radarSourceRegistry[policy.source].credential !== "NONE" && !policy.credentialsVerified) {
    return deny("CREDENTIALS_UNVERIFIED");
  }
  for (const capability of capabilities) {
    if (capability === "train") return deny("TRAINING_DISABLED");
    const right = policy.rights[capability];
    if (right.status !== "APPROVED")
      return deny(`RIGHT_${capability.toUpperCase()}_${right.status}`);
    if (
      !right.evidenceUrl ||
      !right.reviewedBy ||
      !right.checkedAt ||
      !right.expiresAt ||
      Date.parse(right.checkedAt) > nowMs ||
      Date.parse(right.expiresAt) <= nowMs
    ) {
      return deny("RIGHT_EVIDENCE_INVALID_OR_EXPIRED");
    }
  }
  if (capabilities.includes("store") && policy.retentionHours === null) {
    return deny("RETENTION_UNCONFIRMED");
  }
  return { allowed: true };
}

const usageSchema = z.strictObject({
  policyVersion: z.literal(RADAR_POLICY_VERSION),
  source: radarSourceSchema,
  quotaScopeId: identifier,
  pool: identifier,
  runId: identifier,
  dayKey: z.iso.date(),
  runRequests: counter,
  dayRequests: counter,
  runUnits: counter,
  dayUnits: counter,
});
export type RadarBudgetUsage = z.infer<typeof usageSchema>;

export function radarBudgetDayKey(now: string, timeZone: string): string {
  if (!timestamp.safeParse(now).success) throw new Error("Invalid budget timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const requestSchema = z.strictObject({
  source: radarSourceSchema,
  operation: identifier,
  runId: identifier,
});

/** Check ONE attempted request; retries and pagination need their own reservation.
 * R04 must evaluate and reserve atomically in a shared DB ledger before dispatch.
 * This function neither reserves capacity nor performs network I/O.
 */
export function evaluateRadarRequest(
  activation: unknown,
  request: unknown,
  usage: unknown,
  now: string,
): Decision {
  const access = evaluateRadarAccess(activation, ["collect", "store"], now);
  if (!access.allowed) return access;
  const policy = radarActivationSchema.parse(activation);
  const parsedRequest = requestSchema.safeParse(request);
  const parsedUsage = usageSchema.safeParse(usage);
  if (!parsedRequest.success || !parsedUsage.success) return deny("INVALID_BUDGET_INPUT");
  const req = parsedRequest.data;
  const used = parsedUsage.data;
  const operations = radarSourceRegistry[policy.source].operations;
  const limits = Object.hasOwn(operations, req.operation) ? operations[req.operation] : undefined;
  if (!limits) return deny("OPERATION_UNREGISTERED");
  if (
    req.source !== policy.source ||
    used.source !== policy.source ||
    used.quotaScopeId !== policy.quotaScopeId ||
    used.pool !== limits.pool ||
    used.runId !== req.runId ||
    used.dayKey !== radarBudgetDayKey(now, limits.timeZone)
  ) {
    return deny("BUDGET_SCOPE_MISMATCH");
  }
  if (
    used.runRequests >= limits.requestsPerRun ||
    used.runUnits > limits.unitsPerRun - limits.unitCost
  ) {
    return deny("RUN_BUDGET_EXHAUSTED");
  }
  if (
    used.dayRequests >= limits.requestsPerDay ||
    used.dayUnits > limits.unitsPerDay - limits.unitCost
  ) {
    return deny("DAY_BUDGET_EXHAUSTED");
  }
  return { allowed: true };
}

/** Use original fetchedAt, never read/access time. Expired data must not be displayed or derived. */
export function evaluateRadarStoredUse(
  activation: unknown,
  capability: "redisplay" | "derive" | "inference",
  fetchedAt: string,
  now: string,
): Decision {
  if (!["redisplay", "derive", "inference"].includes(capability))
    return deny("INVALID_POLICY_INPUT");
  const access = evaluateRadarAccess(activation, ["store", capability], now);
  if (!access.allowed) return access;
  const policy = radarActivationSchema.parse(activation);
  if (!timestamp.safeParse(fetchedAt).success || Date.parse(fetchedAt) > Date.parse(now)) {
    return deny("INVALID_DATA_TIMESTAMP");
  }
  const hours = Math.min(
    policy.retentionHours ?? 0,
    radarSourceRegistry[policy.source].retentionCeilingHours,
  );
  if (Date.parse(now) - Date.parse(fetchedAt) >= hours * 3_600_000) return deny("DATA_EXPIRED");
  return { allowed: true };
}

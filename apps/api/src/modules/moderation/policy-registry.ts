export const MODERATION_POLICY_ID = "which-moderation" as const;
export const MODERATION_POLICY_VERSION = "1.0.0" as const;

export const MODERATION_POLICY_AXES = [
  "TECHNICAL_SECURITY",
  "CONTENT_SAFETY",
  "PRIVACY",
  "RIGHTS",
  "RELEVANCE",
  "VISUAL_FAIRNESS",
] as const;
export type ModerationPolicyAxis = (typeof MODERATION_POLICY_AXES)[number];

export const MODERATION_SEVERITIES = [
  "S0_CLEAR",
  "S1_DISRUPTIVE",
  "S2_HARMFUL",
  "S3_SEVERE",
  "S4_CRITICAL",
] as const;
export type ModerationSeverity = (typeof MODERATION_SEVERITIES)[number];

export const MODERATION_CONTENT_KINDS = [
  "ISSUE",
  "COMMENT",
  "REPLY",
  "PROFILE",
  "ISSUE_MEDIA",
  "VOTE",
] as const;
export type ModerationContentKind = (typeof MODERATION_CONTENT_KINDS)[number];

export const MODERATION_SOURCES = ["RULE", "MODEL", "OPERATOR"] as const;
export type ModerationSource = (typeof MODERATION_SOURCES)[number];

export const MODERATION_CONTEXT_STATES = ["SUFFICIENT", "INSUFFICIENT", "NOT_APPLICABLE"] as const;
export type ModerationContextState = (typeof MODERATION_CONTEXT_STATES)[number];

export const MODERATION_RIGHTS_STATES = ["ASSERTED", "CHALLENGED", "CLEARED", "WITHDRAWN"] as const;
export type ModerationRightsState = (typeof MODERATION_RIGHTS_STATES)[number];

export const CANONICAL_MODERATION_ACTIONS = [
  "PRIVATE_REJECT",
  "REVIEW",
  "PROVISIONAL",
  "PUBLISHED",
  "QUARANTINED",
  "PURGED",
] as const;
export type CanonicalModerationAction = (typeof CANONICAL_MODERATION_ACTIONS)[number];

export const MODERATION_REASON_CODES = [
  "NO_POLICY_VIOLATION",
  "SPAM",
  "INSULT_OR_HARASSMENT",
  "HATE",
  "THREAT",
  "PRIVACY",
  "SEXUAL",
  "IMPERSONATION",
  "ILLEGAL_ACTIVITY",
  "COORDINATED_ABUSE",
  "OTHER",
  "TECHNICAL_DECODE_FAILED",
  "TECHNICAL_PROHIBITED_FORMAT",
  "TECHNICAL_KNOWN_BLOCK_EXACT_HASH",
  "TECHNICAL_MALWARE_SUSPECTED",
  "CONTENT_GRAPHIC_VIOLENCE",
  "CONTENT_SELF_HARM",
  "CONTENT_SEXUAL_EXPLOITATION",
  "PRIVACY_PII_DETECTED",
  "PRIVACY_IDENTITY_OR_MINOR_UNCERTAIN",
  "RIGHTS_ASSERTION_MISSING",
  "RIGHTS_CHALLENGED",
  "RELEVANCE_OFF_TOPIC",
  "RELEVANCE_MISLEADING_CONTEXT",
  "VISUAL_CHOICE_BIAS",
  "VISUAL_MEDIA_ASYMMETRY",
] as const;
export type ModerationReasonCode = (typeof MODERATION_REASON_CODES)[number];

export type ModerationReasonDefinition = {
  code: ModerationReasonCode;
  axis: ModerationPolicyAxis;
  defaultSeverity: ModerationSeverity;
  targets: readonly ModerationContentKind[];
  requiresContext: boolean;
  deterministicPrivateReject: boolean;
};

const TEXT_TARGETS = ["ISSUE", "COMMENT", "REPLY", "PROFILE"] as const;
const COMMUNITY_TARGETS = ["ISSUE", "COMMENT", "REPLY", "PROFILE", "ISSUE_MEDIA"] as const;
const MEDIA_TARGET = ["ISSUE_MEDIA"] as const;

export const MODERATION_REASON_REGISTRY = [
  {
    code: "NO_POLICY_VIOLATION",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S0_CLEAR",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "SPAM",
    axis: "RELEVANCE",
    defaultSeverity: "S1_DISRUPTIVE",
    targets: TEXT_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "INSULT_OR_HARASSMENT",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S2_HARMFUL",
    targets: TEXT_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "HATE",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "THREAT",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S4_CRITICAL",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "PRIVACY",
    axis: "PRIVACY",
    defaultSeverity: "S3_SEVERE",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "SEXUAL",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "IMPERSONATION",
    axis: "RIGHTS",
    defaultSeverity: "S2_HARMFUL",
    targets: TEXT_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "ILLEGAL_ACTIVITY",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "COORDINATED_ABUSE",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: ["ISSUE", "COMMENT", "REPLY", "VOTE"],
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "OTHER",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S1_DISRUPTIVE",
    targets: COMMUNITY_TARGETS,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "TECHNICAL_DECODE_FAILED",
    axis: "TECHNICAL_SECURITY",
    defaultSeverity: "S2_HARMFUL",
    targets: MEDIA_TARGET,
    requiresContext: false,
    deterministicPrivateReject: true,
  },
  {
    code: "TECHNICAL_PROHIBITED_FORMAT",
    axis: "TECHNICAL_SECURITY",
    defaultSeverity: "S2_HARMFUL",
    targets: MEDIA_TARGET,
    requiresContext: false,
    deterministicPrivateReject: true,
  },
  {
    code: "TECHNICAL_KNOWN_BLOCK_EXACT_HASH",
    axis: "TECHNICAL_SECURITY",
    defaultSeverity: "S4_CRITICAL",
    targets: MEDIA_TARGET,
    requiresContext: false,
    deterministicPrivateReject: true,
  },
  {
    code: "TECHNICAL_MALWARE_SUSPECTED",
    axis: "TECHNICAL_SECURITY",
    defaultSeverity: "S4_CRITICAL",
    targets: MEDIA_TARGET,
    requiresContext: false,
    deterministicPrivateReject: false,
  },
  {
    code: "CONTENT_GRAPHIC_VIOLENCE",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "CONTENT_SELF_HARM",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S3_SEVERE",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "CONTENT_SEXUAL_EXPLOITATION",
    axis: "CONTENT_SAFETY",
    defaultSeverity: "S4_CRITICAL",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "PRIVACY_PII_DETECTED",
    axis: "PRIVACY",
    defaultSeverity: "S3_SEVERE",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "PRIVACY_IDENTITY_OR_MINOR_UNCERTAIN",
    axis: "PRIVACY",
    defaultSeverity: "S4_CRITICAL",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "RIGHTS_ASSERTION_MISSING",
    axis: "RIGHTS",
    defaultSeverity: "S2_HARMFUL",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "RIGHTS_CHALLENGED",
    axis: "RIGHTS",
    defaultSeverity: "S3_SEVERE",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "RELEVANCE_OFF_TOPIC",
    axis: "RELEVANCE",
    defaultSeverity: "S1_DISRUPTIVE",
    targets: ["ISSUE", "ISSUE_MEDIA"],
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "RELEVANCE_MISLEADING_CONTEXT",
    axis: "RELEVANCE",
    defaultSeverity: "S2_HARMFUL",
    targets: ["ISSUE", "ISSUE_MEDIA"],
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "VISUAL_CHOICE_BIAS",
    axis: "VISUAL_FAIRNESS",
    defaultSeverity: "S2_HARMFUL",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
  {
    code: "VISUAL_MEDIA_ASYMMETRY",
    axis: "VISUAL_FAIRNESS",
    defaultSeverity: "S2_HARMFUL",
    targets: MEDIA_TARGET,
    requiresContext: true,
    deterministicPrivateReject: false,
  },
] as const satisfies readonly ModerationReasonDefinition[];

export const DETERMINISTIC_PRIVATE_REJECT_REASONS = MODERATION_REASON_REGISTRY.filter(
  (reason) => reason.deterministicPrivateReject,
).map((reason) => reason.code);

export const LEGACY_COMMENT_REPORT_REASON_MAP = {
  SPAM: "SPAM",
  HARASSMENT: "INSULT_OR_HARASSMENT",
  HATE_OR_ABUSE: "HATE",
  PERSONAL_INFORMATION: "PRIVACY",
  OTHER: "OTHER",
} as const satisfies Record<string, ModerationReasonCode>;

export const COMMENT_MODERATION_ACTION_MAP = {
  COLLAPSE: "REVIEW",
  HIDE: "QUARANTINED",
  REMOVE_POLICY: "QUARANTINED",
  RESTORE: "PUBLISHED",
} as const satisfies Record<string, CanonicalModerationAction>;

export const ISSUE_MEDIA_REVIEW_ACTION_MAP = {
  APPROVED: "PUBLISHED",
  REJECTED: "PRIVATE_REJECT",
  HIDDEN: "QUARANTINED",
  RESTORED: "PUBLISHED",
  DELETED: "PURGED",
} as const satisfies Record<string, CanonicalModerationAction>;

export type ModerationAuthority =
  "ALLOWED" | "DETERMINISTIC_ONLY" | "GATED_REVERSIBLE" | "RECOMMEND_ONLY" | "DENIED";

export type ModerationActionPolicy = {
  action: CanonicalModerationAction;
  reversible: boolean;
  noticeKey: string;
  authority: Readonly<Record<ModerationSource, ModerationAuthority>>;
  releaseGate: "NONE" | "PROVISIONAL_PUBLICATION" | "AUTOMATED_CONTAINMENT";
};

export const MODERATION_ACTION_MATRIX = [
  {
    action: "PRIVATE_REJECT",
    reversible: true,
    noticeKey: "moderation.v1.private_reject",
    authority: {
      RULE: "DETERMINISTIC_ONLY",
      MODEL: "RECOMMEND_ONLY",
      OPERATOR: "ALLOWED",
    },
    releaseGate: "NONE",
  },
  {
    action: "REVIEW",
    reversible: true,
    noticeKey: "moderation.v1.review",
    authority: { RULE: "ALLOWED", MODEL: "ALLOWED", OPERATOR: "ALLOWED" },
    releaseGate: "NONE",
  },
  {
    action: "PROVISIONAL",
    reversible: true,
    noticeKey: "moderation.v1.provisional",
    authority: {
      RULE: "DENIED",
      MODEL: "GATED_REVERSIBLE",
      OPERATOR: "ALLOWED",
    },
    releaseGate: "PROVISIONAL_PUBLICATION",
  },
  {
    action: "PUBLISHED",
    reversible: true,
    noticeKey: "moderation.v1.published",
    authority: { RULE: "DENIED", MODEL: "RECOMMEND_ONLY", OPERATOR: "ALLOWED" },
    releaseGate: "NONE",
  },
  {
    action: "QUARANTINED",
    reversible: true,
    noticeKey: "moderation.v1.quarantined",
    authority: {
      RULE: "GATED_REVERSIBLE",
      MODEL: "GATED_REVERSIBLE",
      OPERATOR: "ALLOWED",
    },
    releaseGate: "AUTOMATED_CONTAINMENT",
  },
  {
    action: "PURGED",
    reversible: false,
    noticeKey: "moderation.v1.purged",
    authority: { RULE: "DENIED", MODEL: "DENIED", OPERATOR: "ALLOWED" },
    releaseGate: "NONE",
  },
] as const satisfies readonly ModerationActionPolicy[];

export const HUMAN_ONLY_DECISIONS = [
  "PERMANENT_CONTENT_DELETION",
  "FEATURE_RESTRICTION_OVER_24_HOURS",
  "ACCOUNT_RESTRICTION",
  "ACCOUNT_TERMINATION",
  "APPEAL_DECISION",
  "RIGHTS_DECISION",
  "VOTE_INVALIDATION",
  "RESULT_CORRECTION",
  "IDENTITY_DECISION",
  "MINOR_STATUS_DECISION",
] as const;
export type HumanOnlyDecision = (typeof HUMAN_ONLY_DECISIONS)[number];

export const MODERATION_RIGHTS_AUTHORITY = {
  ASSERTED: ["OPERATOR"],
  CHALLENGED: ["RULE", "OPERATOR"],
  CLEARED: ["OPERATOR"],
  WITHDRAWN: ["OPERATOR"],
} as const satisfies Readonly<Record<ModerationRightsState, readonly ModerationSource[]>>;

export const MODERATION_POLICY_ROLLOUT = {
  automationDefault: "OFF",
  modes: ["OFF", "SHADOW", "REVIEW_ASSIST", "LIMITED_ACTION"] as const,
  minimumShadowDays: 30,
  rollbackAction: "REVIEW" as const,
  policyVersionPinningRequired: true,
  killSwitchRequired: true,
  canarySlices: ["NEW_MEMBER", "COMMENT_SIDE_A", "COMMENT_SIDE_B", "REPLY", "ISSUE_MEDIA"] as const,
};

const actionPolicyByAction = new Map(
  MODERATION_ACTION_MATRIX.map((policy) => [policy.action, policy] as const),
);
const reasonPolicyByCode = new Map(
  MODERATION_REASON_REGISTRY.map((reason) => [reason.code, reason] as const),
);

export function getModerationReason(code: ModerationReasonCode): ModerationReasonDefinition {
  const reason = reasonPolicyByCode.get(code);
  if (!reason) {
    throw new Error(`Unknown moderation reason: ${code}`);
  }
  return reason;
}

export function getModerationActionPolicy(
  action: CanonicalModerationAction,
): ModerationActionPolicy {
  const policy = actionPolicyByAction.get(action);
  if (!policy) {
    throw new Error(`Unknown moderation action: ${action}`);
  }
  return policy;
}

export function resolveModerationAuthority(input: {
  source: ModerationSource;
  action: CanonicalModerationAction;
  reasonCode: ModerationReasonCode;
  contextState: ModerationContextState;
  releaseGateEnabled?: boolean;
}): {
  allowed: boolean;
  authority: ModerationAuthority;
  fallbackAction: CanonicalModerationAction;
} {
  const reason = getModerationReason(input.reasonCode);
  const action = getModerationActionPolicy(input.action);
  const fallbackAction = "REVIEW" as const;

  if (reason.requiresContext && input.contextState !== "SUFFICIENT") {
    return {
      allowed: input.action === fallbackAction,
      authority: "RECOMMEND_ONLY",
      fallbackAction,
    };
  }

  const authority = action.authority[input.source];
  if (authority === "DETERMINISTIC_ONLY") {
    return {
      allowed: reason.deterministicPrivateReject,
      authority,
      fallbackAction,
    };
  }
  if (authority === "GATED_REVERSIBLE") {
    return {
      allowed: input.releaseGateEnabled === true && action.reversible,
      authority,
      fallbackAction,
    };
  }

  return { allowed: authority === "ALLOWED", authority, fallbackAction };
}

export function mapIssueMediaState(input: {
  moderationState: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
  storageState: "STAGED" | "PUBLISHED" | "QUARANTINED" | "PURGED";
}): CanonicalModerationAction {
  if (input.storageState === "PURGED") return "PURGED";
  if (input.storageState === "QUARANTINED" || input.moderationState === "REVOKED") {
    return "QUARANTINED";
  }
  if (input.moderationState === "REJECTED") return "PRIVATE_REJECT";
  if (input.moderationState === "APPROVED" && input.storageState === "PUBLISHED") {
    return "PUBLISHED";
  }
  return "REVIEW";
}

export function mapCommentState(input: {
  publicationState: "PENDING_AUTOMOD" | "PENDING_HUMAN_REVIEW" | "PUBLISHED" | "FAILED";
  visibility:
    "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "HIDDEN" | "REMOVED_BY_AUTHOR" | "REMOVED_POLICY";
  integrityState: "NORMAL" | "REVIEW" | "REJECTED" | "INVALIDATED";
}): CanonicalModerationAction | null {
  if (input.visibility === "REMOVED_BY_AUTHOR") return null;
  if (
    input.visibility === "HIDDEN" ||
    input.visibility === "REMOVED_POLICY" ||
    input.integrityState === "REJECTED" ||
    input.integrityState === "INVALIDATED"
  ) {
    return "QUARANTINED";
  }
  if (
    input.publicationState === "PENDING_AUTOMOD" ||
    input.publicationState === "PENDING_HUMAN_REVIEW" ||
    input.publicationState === "FAILED" ||
    input.integrityState === "REVIEW"
  ) {
    return "REVIEW";
  }
  return "PUBLISHED";
}

export function buildModerationNoticeKey(input: {
  action: CanonicalModerationAction;
  reasonCode: ModerationReasonCode;
}): string {
  return `moderation.v1.${input.action.toLowerCase()}.${input.reasonCode.toLowerCase()}`;
}

export function canSourceSetRightsState(
  source: ModerationSource,
  state: ModerationRightsState,
): boolean {
  return (MODERATION_RIGHTS_AUTHORITY[state] as readonly ModerationSource[]).includes(source);
}

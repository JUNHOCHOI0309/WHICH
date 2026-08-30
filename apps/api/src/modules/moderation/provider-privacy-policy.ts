export const IMAGE_PROVIDER_PRIVACY_POLICY = {
  id: "which-image-provider-privacy-gate",
  version: "1.0.0",
  defaultMode: "OFF",
  maximumDerivativeSidePx: 1_024,
  maximumContextCharacters: 1_500,
} as const;

export type ImageProviderMode = "OFF" | "SHADOW" | "REVIEWER_ASSIST";
export type ImageModerationProvider =
  "OPENAI_MODERATION" | "OPENAI_POLICY_JUDGE" | "GOOGLE_CLOUD_VISION";

export const PROHIBITED_EXTERNAL_FIELD_NAMES = [
  "rawIp",
  "ipAddress",
  "deviceId",
  "oauthSubject",
  "email",
  "voteChoice",
  "memberId",
  "guestId",
] as const;

const normalizedProhibitedFieldNames = new Set(
  PROHIBITED_EXTERNAL_FIELD_NAMES.map((field) => normalizeFieldName(field)),
);

export const FACE_PROCESSING_BOUNDARY = {
  allowed: ["FACE_PRESENCE_ROUTING"],
  prohibited: [
    "FACE_RECOGNITION",
    "IDENTITY_MATCHING",
    "IDENTITY_INFERENCE",
    "DEMOGRAPHIC_OR_ATTRIBUTE_INFERENCE",
    "MINOR_OR_AGE_INFERENCE",
    "BIOMETRIC_EMBEDDING",
  ],
} as const;

export const IMAGE_MODERATION_RETENTION = {
  RAW_UPLOAD: {
    ttlDays: 0,
    purgeWithinHours: 1,
    rule: "Keep only in the isolated processing path until a normalized derivative exists.",
  },
  STAGING_DERIVATIVE: {
    ttlDays: 14,
    purgeWithinHours: 24,
    rule: "Delete after expiry unless an active appeal, rights request, or legal hold overrides it.",
  },
  REJECTED_OR_QUARANTINED_BINARY: {
    ttlDays: 30,
    purgeWithinHours: 24,
    rule: "Count from the final decision or appeal resolution, whichever is later.",
  },
  OCR_TEXT_AND_COORDINATES: {
    ttlDays: 7,
    purgeWithinHours: 24,
    rule: "Store in the restricted moderation evidence plane, never application logs.",
  },
  PROVIDER_INPUT_OUTPUT: {
    ttlDays: 0,
    purgeWithinHours: 1,
    rule: "Do not persist request pixels, prompts, OCR text, or raw provider responses.",
  },
  PROVIDER_DERIVED_LABELS: {
    ttlDays: 180,
    purgeWithinHours: 24,
    rule: "Persist only policy-versioned labels, scores, timing, cost, and sanitized error codes.",
  },
  SHA256_AND_DHASH: {
    ttlDays: 365,
    purgeWithinHours: 24,
    rule: "Count from binary purge; hashes remain restricted and are not public identifiers.",
  },
  APPEAL_EVIDENCE: {
    ttlDays: 180,
    purgeWithinHours: 24,
    rule: "Count from final appeal resolution.",
  },
  RIGHTS_EVIDENCE: {
    ttlDays: 1_095,
    purgeWithinHours: 24,
    rule: "Count from final rights resolution; this period requires legal review before launch.",
  },
  LEGAL_HOLD: {
    ttlDays: 0,
    purgeWithinHours: 720,
    rule: "Event-bound exception: retain until an authorized release, then purge within 30 days.",
  },
} as const;

export const RETENTION_OVERRIDE_PRECEDENCE = {
  CONTENT_DELETION: 100,
  MEMBER_DELETION: 200,
  APPEAL: 300,
  RIGHTS: 400,
  LEGAL_HOLD: 500,
} as const;

type ProviderEvidenceKey =
  | "dpaExecuted"
  | "noTrainingConfirmed"
  | "retentionTermsRecorded"
  | "deletionTermsRecorded"
  | "subprocessorsRecorded"
  | "processingRegionRecorded"
  | "encryptionConfirmed"
  | "credentialRotationOwnerAssigned"
  | "breachResponseRecorded"
  | "internationalTransferLegalReviewApproved"
  | "providerDataControlApproved";

export type ProviderGateEvidence = Record<ProviderEvidenceKey, boolean>;

const REQUIRED_PROVIDER_EVIDENCE = [
  "dpaExecuted",
  "noTrainingConfirmed",
  "retentionTermsRecorded",
  "deletionTermsRecorded",
  "subprocessorsRecorded",
  "processingRegionRecorded",
  "encryptionConfirmed",
  "credentialRotationOwnerAssigned",
  "breachResponseRecorded",
  "internationalTransferLegalReviewApproved",
  "providerDataControlApproved",
] as const satisfies readonly ProviderEvidenceKey[];

export const IMAGE_MODERATION_PROVIDER_REGISTRY = {
  OPENAI_POLICY_JUDGE: {
    approval: "CONDITIONAL",
    allowedRole: "PAIR_CONTEXT_POLICY_SHADOW",
    endpoint: "/v1/responses",
    processingBoundary: "KOREA_STORAGE_DOES_NOT_GUARANTEE_KOREA_PROCESSING",
    prohibitedRoles: ["PUBLICATION_AUTHORITY", "RIGHTS_DECISION", "IDENTITY_DECISION"],
    requiredControls: [
      "DPA",
      "RESPONSES_DATA_CONTROL_APPROVAL",
      "STORE_FALSE",
      "PROJECT_SCOPED_KEY",
    ],
  },
  OPENAI_MODERATION: {
    approval: "CONDITIONAL",
    allowedRole: "CONTENT_SAFETY_SHADOW",
    endpoint: "/v1/moderations",
    processingBoundary: "KOREA_STORAGE_DOES_NOT_GUARANTEE_KOREA_PROCESSING",
    prohibitedRoles: ["OCR_SOURCE_OF_TRUTH", "RIGHTS_DECISION", "IDENTITY_DECISION"],
    requiredControls: ["DPA", "ENHANCED_ZDR_OR_MAM_APPROVAL", "PROJECT_SCOPED_KEY"],
  },
  GOOGLE_CLOUD_VISION: {
    approval: "CONDITIONAL",
    allowedRole: "OCR_QR_OR_SAFESEARCH_SHADOW",
    endpoint: "VISION_API",
    processingBoundary: "CONTRACT_AND_LOCATION_CONFIGURATION_DEPENDENT",
    prohibitedRoles: ["RIGHTS_DECISION", "IDENTITY_DECISION", "BIOMETRIC_PROCESSING"],
    requiredControls: ["DPA", "SUBPROCESSOR_REVIEW", "PROJECT_SCOPED_SERVICE_ACCOUNT"],
  },
} as const;

export interface ExternalImageModerationEnvelopeInput {
  provider: ImageModerationProvider;
  opaqueRequestId: string;
  derivative: {
    mimeType: "image/webp";
    width: number;
    height: number;
    byteLength: number;
    metadataStripped: true;
    reencoded: true;
    content: string;
  };
  context?: {
    question?: string;
    choices?: string[];
    altText?: string;
    piiRedacted: true;
  };
}

export interface ExternalImageModerationEnvelope {
  policy: typeof IMAGE_PROVIDER_PRIVACY_POLICY;
  provider: ImageModerationProvider;
  opaqueRequestId: string;
  media: ExternalImageModerationEnvelopeInput["derivative"];
  context?: ExternalImageModerationEnvelopeInput["context"];
}

export function evaluateImageProviderGate(input: {
  mode: ImageProviderMode;
  provider: ImageModerationProvider | "NONE";
  evidence: ProviderGateEvidence;
}) {
  const missingEvidence = REQUIRED_PROVIDER_EVIDENCE.filter((key) => !input.evidence[key]);
  const providerSelected = input.provider !== "NONE";
  const allowed = input.mode !== "OFF" && providerSelected && missingEvidence.length === 0;

  return {
    allowed,
    missingEvidence,
    reason: allowed
      ? "PROVIDER_GATE_SATISFIED"
      : input.mode === "OFF"
        ? "PROVIDER_MODE_OFF"
        : !providerSelected
          ? "PROVIDER_NOT_SELECTED"
          : "PROVIDER_EVIDENCE_INCOMPLETE",
  } as const;
}

export function buildExternalImageModerationEnvelope(
  input: ExternalImageModerationEnvelopeInput,
): ExternalImageModerationEnvelope {
  assertNoProhibitedExternalFields(input);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.opaqueRequestId)) {
    throw new Error("Provider request IDs must be opaque and contain 16-128 safe characters.");
  }
  if (
    input.derivative.mimeType !== "image/webp" ||
    input.derivative.metadataStripped !== true ||
    input.derivative.reencoded !== true
  ) {
    throw new Error("Only EXIF-stripped, re-encoded WebP derivatives may leave WHICH.");
  }
  if (
    input.derivative.width < 1 ||
    input.derivative.height < 1 ||
    Math.max(input.derivative.width, input.derivative.height) >
      IMAGE_PROVIDER_PRIVACY_POLICY.maximumDerivativeSidePx
  ) {
    throw new Error("The provider derivative exceeds the approved image dimensions.");
  }
  if (!input.derivative.content || input.derivative.byteLength < 1) {
    throw new Error("A non-empty normalized derivative is required.");
  }
  if (input.context) {
    if (input.context.piiRedacted !== true) {
      throw new Error("Provider context must pass the local PII redaction gate.");
    }
    const contextCharacters = [
      input.context.question,
      ...(input.context.choices ?? []),
      input.context.altText,
    ].reduce((total, value) => total + (value?.length ?? 0), 0);
    if (contextCharacters > IMAGE_PROVIDER_PRIVACY_POLICY.maximumContextCharacters) {
      throw new Error("Provider context exceeds the data-minimization limit.");
    }
  }

  return {
    policy: IMAGE_PROVIDER_PRIVACY_POLICY,
    provider: input.provider,
    opaqueRequestId: input.opaqueRequestId,
    media: input.derivative,
    ...(input.context ? { context: input.context } : {}),
  };
}

export function assertNoProhibitedExternalFields(value: unknown, path = "payload"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedExternalFields(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (normalizedProhibitedFieldNames.has(normalizeFieldName(key))) {
      throw new Error(`Prohibited provider field at ${path}.${key}.`);
    }
    assertNoProhibitedExternalFields(nestedValue, `${path}.${key}`);
  }
}

export function sanitizeProviderFailure(input: {
  provider: ImageModerationProvider;
  stage: "ENVELOPE_BUILD" | "PROVIDER_REQUEST" | "PROVIDER_RESPONSE" | "RESULT_VALIDATION";
  errorCode?: string;
  httpStatus?: number;
  retryable?: boolean;
}) {
  return {
    provider: input.provider,
    stage: input.stage,
    errorCode: sanitizeErrorCode(input.errorCode),
    httpStatus:
      input.httpStatus && input.httpStatus >= 100 && input.httpStatus <= 599
        ? input.httpStatus
        : null,
    retryable: input.retryable === true,
  };
}

function normalizeFieldName(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sanitizeErrorCode(value?: string) {
  if (!value) return "UNKNOWN";
  return /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(value) ? value : "UNCLASSIFIED_PROVIDER_ERROR";
}

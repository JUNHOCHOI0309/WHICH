export const MODERATION_RULE_VERSION = "which-common-rules-v1";

export type ModerationTrustTier = "GUEST" | "MEMBER" | "TRUSTED" | "OPERATOR";
export type RuleSeverity = "INFO" | "REVIEW" | "BLOCK";
export type RuleSignal = {
  code: string;
  severity: RuleSeverity;
  ruleVersion: typeof MODERATION_RULE_VERSION;
  metadata?: Record<string, number | string | boolean>;
};

const URL_PATTERN = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|kr|io)(?:\/|\b))/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?<!\d)(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/u;
const ACCOUNT_PATTERN = /(?<!\d)\d{2,6}[- ]\d{2,6}[- ]\d{2,8}(?!\d)/u;
const REPEATED_CHARACTER_PATTERN = /(.)\1{7,}/u;
const SCRIPT_PATTERNS = [/[가-힣]/u, /[A-Za-z]/u, /[\u3040-\u30ff]/u, /[\u4e00-\u9fff]/u];

export const TRUST_TIER_WINDOWS: Record<
  ModerationTrustTier,
  { maximumActions: number; windowSeconds: number }
> = {
  GUEST: { maximumActions: 6, windowSeconds: 60 },
  MEMBER: { maximumActions: 12, windowSeconds: 60 },
  TRUSTED: { maximumActions: 30, windowSeconds: 60 },
  OPERATOR: { maximumActions: 120, windowSeconds: 60 },
};

export function normalizeModerationText(value: string, mode: "INLINE" | "MULTILINE" = "INLINE") {
  const normalized = value.replace(/\r\n?/gu, "\n").normalize("NFC").trim();
  return mode === "INLINE"
    ? normalized.replace(/\s+/gu, " ")
    : normalized
        .split("\n")
        .map((line) => line.replace(/[\t ]+/gu, " ").trimEnd())
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n");
}

function repeatedTokenRatio(value: string) {
  const tokens = value.toLocaleLowerCase("ko-KR").split(/\s+/u).filter(Boolean);
  if (tokens.length < 6) return 0;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return Math.max(...counts.values()) / tokens.length;
}

export function evaluateTextRules(input: {
  value: string;
  minimumLength: number;
  maximumLength: number;
  allowUrls?: boolean;
  trustTier?: ModerationTrustTier;
}): {
  normalized: string;
  signals: RuleSignal[];
  window: (typeof TRUST_TIER_WINDOWS)[ModerationTrustTier];
} {
  const normalized = normalizeModerationText(input.value, "MULTILINE");
  const length = Array.from(normalized).length;
  const signals: RuleSignal[] = [];
  const signal = (code: string, severity: RuleSeverity, metadata?: RuleSignal["metadata"]) =>
    signals.push({
      code,
      severity,
      ruleVersion: MODERATION_RULE_VERSION,
      ...(metadata ? { metadata } : {}),
    });

  if (length < input.minimumLength || length > input.maximumLength) {
    signal("TEXT_LENGTH_OUT_OF_RANGE", "BLOCK", { length });
  }
  if (!input.allowUrls && URL_PATTERN.test(normalized)) signal("TEXT_URL_PRESENT", "BLOCK");
  if (REPEATED_CHARACTER_PATTERN.test(normalized)) signal("TEXT_CHARACTER_FLOOD", "REVIEW");
  const tokenRatio = repeatedTokenRatio(normalized);
  if (tokenRatio >= 0.5) signal("TEXT_TOKEN_REPETITION", "REVIEW", { ratio: tokenRatio });
  const scriptCount = SCRIPT_PATTERNS.filter((pattern) => pattern.test(normalized)).length;
  if (scriptCount >= 3) signal("TEXT_MIXED_SCRIPT", "REVIEW", { scriptCount });
  if (EMAIL_PATTERN.test(normalized)) signal("PRIVACY_EMAIL_DETECTED", "REVIEW");
  if (PHONE_PATTERN.test(normalized)) signal("PRIVACY_PHONE_DETECTED", "REVIEW");
  if (ACCOUNT_PATTERN.test(normalized)) signal("PRIVACY_ACCOUNT_PATTERN_DETECTED", "REVIEW");

  return {
    normalized,
    signals,
    window: TRUST_TIER_WINDOWS[input.trustTier ?? "MEMBER"],
  };
}

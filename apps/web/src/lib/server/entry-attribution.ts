import { createHmac, timingSafeEqual } from "node:crypto";

export const ENTRY_ATTRIBUTION_COOKIE = "which_entry_attribution";
export const ENTRY_ATTRIBUTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const NAVER_ENTRY_MEDIA = [
  "choice",
  "cafe",
  "clip_blog",
  "blog_search",
  "homefeed_da",
  "lounge",
  "band",
] as const;

export type NaverEntryMedium = (typeof NAVER_ENTRY_MEDIA)[number];
export const SHARE_ENTRY_MEDIA = ["copy", "system", "x"] as const;
export type ShareEntryMedium = (typeof SHARE_ENTRY_MEDIA)[number];

export type EntryAttribution =
  | {
      version: 1;
      source: "naver";
      medium: NaverEntryMedium;
      campaign?: string;
      content?: string;
      capturedAt: number;
    }
  | {
      version: 1;
      source: "share";
      medium: ShareEntryMedium;
      campaign: "result" | "result_with_choice";
      content: string;
      capturedAt: number;
    };

const allowedNaverMedia = new Set<string>(NAVER_ENTRY_MEDIA);
const allowedShareMedia = new Set<string>(SHARE_ENTRY_MEDIA);
const safeUtmToken = /^[a-z0-9][a-z0-9._-]*$/;
const uuidToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const signatureContext = "which-entry-attribution-v1\0";

function signingSecret() {
  const configured = process.env.ATTRIBUTION_COOKIE_SECRET ?? process.env.AUTH_FLOW_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ATTRIBUTION_COOKIE_SECRET or AUTH_FLOW_SECRET is required in production.");
  }
  return "which-local-entry-attribution-secret-change-me";
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret())
    .update(signatureContext)
    .update(payload)
    .digest("base64url");
}

function safeToken(value: string, maxLength: number) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > maxLength || !safeUtmToken.test(normalized)) {
    return null;
  }
  return normalized;
}

function singleParameter(searchParams: URLSearchParams, name: string, required: boolean) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return required ? null : undefined;
  if (values.length !== 1) return null;
  return values[0];
}

export function entryAttributionFromSearchParams(
  searchParams: URLSearchParams,
  capturedAt = Date.now(),
): EntryAttribution | null {
  const sourceValue = singleParameter(searchParams, "utm_source", true);
  if (typeof sourceValue !== "string") return null;
  const source = sourceValue.trim().toLowerCase();

  const mediumValue = singleParameter(searchParams, "utm_medium", true);
  if (typeof mediumValue !== "string") return null;
  const medium = mediumValue.trim().toLowerCase();
  const campaignValue = singleParameter(searchParams, "utm_campaign", false);
  const contentValue = singleParameter(searchParams, "utm_content", false);
  if (campaignValue === null || contentValue === null) return null;

  if (source === "share") {
    const campaign = typeof campaignValue === "string" ? campaignValue.trim().toLowerCase() : "";
    const content = typeof contentValue === "string" ? contentValue.trim().toLowerCase() : "";
    if (
      !allowedShareMedia.has(medium) ||
      (campaign !== "result" && campaign !== "result_with_choice") ||
      !uuidToken.test(content)
    ) {
      return null;
    }
    return {
      version: 1,
      source: "share",
      medium: medium as ShareEntryMedium,
      campaign,
      content,
      capturedAt,
    };
  }
  if (source !== "naver" || !allowedNaverMedia.has(medium)) return null;

  const campaign = typeof campaignValue === "string" ? safeToken(campaignValue, 64) : undefined;
  const content = typeof contentValue === "string" ? safeToken(contentValue, 96) : undefined;
  if (
    (typeof campaignValue === "string" && !campaign) ||
    (typeof contentValue === "string" && !content)
  ) {
    return null;
  }

  return {
    version: 1,
    source: "naver",
    medium: medium as NaverEntryMedium,
    ...(campaign ? { campaign } : {}),
    ...(content ? { content } : {}),
    capturedAt,
  };
}

export function encodeEntryAttribution(attribution: EntryAttribution) {
  const payload = Buffer.from(JSON.stringify(attribution)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function decodeEntryAttribution(
  value: string | undefined,
  now = Date.now(),
): EntryAttribution | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = signature(payload);
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<EntryAttribution>;
    const maxAgeMilliseconds = ENTRY_ATTRIBUTION_MAX_AGE_SECONDS * 1_000;
    const commonInvalid =
      parsed.version !== 1 ||
      typeof parsed.medium !== "string" ||
      typeof parsed.capturedAt !== "number" ||
      !Number.isInteger(parsed.capturedAt) ||
      parsed.capturedAt > now + 5 * 60 * 1_000 ||
      now - parsed.capturedAt > maxAgeMilliseconds;
    if (commonInvalid) return null;
    const medium = parsed.medium as string;
    if (parsed.source === "share") {
      if (
        !allowedShareMedia.has(medium) ||
        (parsed.campaign !== "result" && parsed.campaign !== "result_with_choice") ||
        typeof parsed.content !== "string" ||
        !uuidToken.test(parsed.content)
      )
        return null;
    } else if (
      parsed.source !== "naver" ||
      !allowedNaverMedia.has(medium) ||
      (parsed.campaign !== undefined &&
        (typeof parsed.campaign !== "string" ||
          safeToken(parsed.campaign, 64) !== parsed.campaign)) ||
      (parsed.content !== undefined &&
        (typeof parsed.content !== "string" || safeToken(parsed.content, 96) !== parsed.content))
    )
      return null;
    return parsed as EntryAttribution;
  } catch {
    return null;
  }
}

import { createHash } from "node:crypto";

import { z } from "zod";

import { radarSourceSchema } from "./contracts.js";

export const RADAR_ENTITY_RESOLVER_VERSION = "radar-entity-resolver-v1";

const timestamp = z.iso.datetime({ offset: true });
const label = z.string().min(1).max(500);
const languageCode = z.string().trim().min(2).max(35);

function isUnsafeFormatting(codePoint: number) {
  return (
    codePoint <= 0x08 ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    codePoint === 0x2060 ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

const topicCandidateSchema = z.strictObject({
  label,
  languageCode,
  source: radarSourceSchema,
  observedAt: timestamp,
});

export const topicAliasSchema = z.strictObject({
  topicId: z.uuid(),
  alias: label,
  normalizedAlias: label,
  languageCode,
  source: radarSourceSchema.nullable(),
  validFrom: timestamp.nullable(),
  validUntil: timestamp.nullable(),
  status: z.enum(["CANDIDATE", "VERIFIED", "REJECTED"]),
});

const eventTimeSchema = z
  .strictObject({
    occurredAt: timestamp.nullable(),
    timePrecision: z.enum(["EXACT", "DAY", "UNKNOWN"]),
  })
  .refine((value) => (value.occurredAt === null) === (value.timePrecision === "UNKNOWN"), {
    message: "Unknown event time requires null; known time requires an instant",
  });

const eventCandidateSchema = eventTimeSchema.extend({
  title: label,
  languageCode,
  source: radarSourceSchema,
  sourceItemId: z.string().trim().min(1).max(500),
  topicIds: z.array(z.uuid()).min(1).max(100),
});

const eventProfileSchema = eventTimeSchema.extend({
  eventId: z.uuid(),
  title: label,
  languageCode,
  topicIds: z.array(z.uuid()).min(1).max(100),
  references: z
    .array(
      z.strictObject({
        source: radarSourceSchema,
        sourceItemId: z.string().trim().min(1).max(500),
      }),
    )
    .max(100),
});

export type TopicCandidate = z.infer<typeof topicCandidateSchema>;
export type TopicAlias = z.infer<typeof topicAliasSchema>;
export type EventCandidate = z.infer<typeof eventCandidateSchema>;
export type EventProfile = z.infer<typeof eventProfileSchema>;

export type EntityResolution =
  | { status: "MATCHED"; entityId: string; basis: string }
  | { status: "AMBIGUOUS"; entityIds: string[]; basis: string }
  | { status: "UNRESOLVED"; entityIds: []; basis: string };

export function normalizeEntityLabel(value: string) {
  if ([...value].some((character) => isUnsafeFormatting(character.codePointAt(0)!))) {
    throw new Error("UNSAFE_ENTITY_LABEL");
  }
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 500) throw new Error("INVALID_ENTITY_LABEL");
  return normalized;
}

export function canonicalLanguageCode(value: string) {
  const raw = languageCode.parse(value);
  try {
    const [canonical] = Intl.getCanonicalLocales(raw);
    if (!canonical) throw new Error("INVALID_LANGUAGE_CODE");
    return canonical;
  } catch {
    throw new Error("INVALID_LANGUAGE_CODE");
  }
}

function digest(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function topicAliasKey(input: Omit<TopicAlias, "normalizedAlias">) {
  return digest([
    "radar-topic-alias-v1",
    input.topicId,
    normalizeEntityLabel(input.alias),
    canonicalLanguageCode(input.languageCode),
    input.source,
    input.validFrom === null ? null : new Date(input.validFrom).toISOString(),
    input.validUntil === null ? null : new Date(input.validUntil).toISOString(),
  ]);
}

export function eventReferenceKey(input: {
  eventId: string;
  source: z.infer<typeof radarSourceSchema>;
  sourceItemId: string;
}) {
  return digest([
    "radar-event-source-reference-v1",
    input.eventId,
    input.source,
    input.sourceItemId,
  ]);
}

function validAt(alias: TopicAlias, observedAt: string) {
  const at = Date.parse(observedAt);
  return (
    (alias.validFrom === null || Date.parse(alias.validFrom) <= at) &&
    (alias.validUntil === null || at < Date.parse(alias.validUntil))
  );
}

function resultFor(
  ids: string[],
  matchedBasis: string,
  ambiguousBasis = matchedBasis,
): EntityResolution {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 1) return { status: "MATCHED", entityId: unique[0]!, basis: matchedBasis };
  if (unique.length > 1) return { status: "AMBIGUOUS", entityIds: unique, basis: ambiguousBasis };
  return { status: "UNRESOLVED", entityIds: [], basis: "NO_VERIFIED_MATCH" };
}

/** Exact, deterministic alias resolution. Fuzzy or embedding similarity must never call this a match. */
export function resolveTopicCandidate(candidateInput: unknown, aliasesInput: unknown[]) {
  const candidate = topicCandidateSchema.parse(candidateInput);
  const normalizedLabel = normalizeEntityLabel(candidate.label);
  const language = canonicalLanguageCode(candidate.languageCode);
  const aliases = aliasesInput.map((input) => {
    const alias = topicAliasSchema.parse(input);
    if (
      alias.normalizedAlias !== normalizeEntityLabel(alias.alias) ||
      alias.languageCode !== canonicalLanguageCode(alias.languageCode)
    ) {
      throw new Error("STALE_TOPIC_ALIAS_NORMALIZATION");
    }
    return alias;
  });
  const eligible = aliases.filter(
    (alias) =>
      alias.status === "VERIFIED" &&
      alias.normalizedAlias === normalizedLabel &&
      alias.languageCode === language &&
      validAt(alias, candidate.observedAt),
  );
  const sourceSpecific = eligible.filter((alias) => alias.source === candidate.source);
  if (sourceSpecific.length) {
    return resultFor(
      sourceSpecific.map((alias) => alias.topicId),
      "VERIFIED_SOURCE_ALIAS",
    );
  }
  return resultFor(
    eligible.filter((alias) => alias.source === null).map((alias) => alias.topicId),
    "VERIFIED_GLOBAL_ALIAS",
  );
}

function sameTopics(left: string[], right: string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return (
    a.length === left.length && b.length === right.length && JSON.stringify(a) === JSON.stringify(b)
  );
}

function sameKnownEventTime(candidate: EventCandidate, profile: EventProfile) {
  if (candidate.timePrecision === "UNKNOWN" || profile.timePrecision === "UNKNOWN") return false;
  if (candidate.timePrecision === "EXACT" && profile.timePrecision === "EXACT") {
    return candidate.occurredAt === profile.occurredAt;
  }
  return candidate.occurredAt!.slice(0, 10) === profile.occurredAt!.slice(0, 10);
}

/** Provider identity wins. Cross-source matching is intentionally strict and time-aware. */
export function resolveEventCandidate(candidateInput: unknown, profilesInput: unknown[]) {
  const candidate = eventCandidateSchema.parse(candidateInput);
  if (new Set(candidate.topicIds).size !== candidate.topicIds.length) {
    throw new Error("DUPLICATE_EVENT_TOPIC");
  }
  const profiles = profilesInput.map((input) => eventProfileSchema.parse(input));
  const exactReferences = profiles.filter((profile) =>
    profile.references.some(
      (reference) =>
        reference.source === candidate.source && reference.sourceItemId === candidate.sourceItemId,
    ),
  );
  if (exactReferences.length) {
    return resultFor(
      exactReferences.map((profile) => profile.eventId),
      "EXACT_SOURCE_REFERENCE",
    );
  }
  const normalizedTitle = normalizeEntityLabel(candidate.title);
  const language = canonicalLanguageCode(candidate.languageCode);
  const contextual = profiles.filter(
    (profile) =>
      normalizeEntityLabel(profile.title) === normalizedTitle &&
      canonicalLanguageCode(profile.languageCode) === language &&
      sameTopics(candidate.topicIds, profile.topicIds) &&
      sameKnownEventTime(candidate, profile),
  );
  return resultFor(
    contextual.map((profile) => profile.eventId),
    "EXACT_TITLE_TOPICS_AND_TIME",
  );
}

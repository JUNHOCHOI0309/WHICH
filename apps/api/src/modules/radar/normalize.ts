import { createHash } from "node:crypto";
import { radarObservationSchema, type RadarObservation } from "./contracts.js";

const normalizeText = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
const digest = (values: unknown[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

/** Pure validation/normalization. Never fetches, persists, merges topics or publishes. */
export function normalizeRadarObservation(input: unknown) {
  const parsed = radarObservationSchema.parse(input);
  const url = new URL(parsed.sourceUrl);
  url.hash = "";
  // Preserve query parameters: some providers identify the resource by query.
  const observation: RadarObservation = {
    ...parsed,
    title: normalizeText(parsed.title),
    sourceUrl: url.href,
  };
  // A metric correction in the same sample keeps its identity but changes the
  // content hash. Persistence must retain the correction instead of duplicating it.
  const observationKey = digest([
    "radar-observation-v1",
    observation.source,
    observation.sourceItemId,
    observation.metricName,
    observation.metric.kind,
    "comparisonKey" in observation.metric ? observation.metric.comparisonKey : null,
    observation.scope.countryCode,
    observation.scope.queryKey,
    observation.scope.dimensionsKey,
    observation.window.start,
    observation.window.end,
    observation.window.granularity,
    observation.sampledAt,
  ]);
  const contentHash = digest([
    "radar-content-v1",
    observationKey,
    observation.title,
    observation.sourceUrl,
    observation.sourceUpdatedAt,
    observation.metric.value,
  ]);
  return { observation, observationKey, contentHash };
}

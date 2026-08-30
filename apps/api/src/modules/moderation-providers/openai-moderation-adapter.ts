import { z } from "zod";
import { openAiCoverage } from "./openai-coverage.js";
import { embeddedTextEvidenceSchema } from "../issue-media/embedded-text.js";

import type { ModerationShadowAdapter } from "../moderation-dispatch/contracts.js";
import {
  calibratedBand,
  MODERATION_PROVIDER_RESULT_SCHEMA_VERSION,
  ModerationProviderCallError,
  type ModerationProviderInput,
  type ModerationProviderSignal,
} from "./contracts.js";

const categoryCode: Record<string, string> = {
  harassment: "INSULT_OR_HARASSMENT",
  "harassment/threatening": "THREAT",
  hate: "HATE",
  "hate/threatening": "THREAT",
  illicit: "ILLEGAL_ACTIVITY",
  "illicit/violent": "ILLEGAL_ACTIVITY",
  "self-harm": "CONTENT_SELF_HARM",
  "self-harm/instructions": "CONTENT_SELF_HARM",
  "self-harm/intent": "CONTENT_SELF_HARM",
  sexual: "SEXUAL",
  "sexual/minors": "CONTENT_SEXUAL_EXPLOITATION",
  violence: "OTHER",
  "violence/graphic": "CONTENT_GRAPHIC_VIOLENCE",
};

const unsupportedLabels = [
  "PERSONAL_INFORMATION",
  "SPAM_OR_MANIPULATION",
  "COPYRIGHT_OR_RIGHTS",
  "DEFAMATION",
  "ISSUE_RELEVANCE",
  "VISUAL_FAIRNESS",
  "FACE_IDENTITY",
];

const resultSchema = z.object({
  flagged: z.boolean(),
  categories: z.record(z.string(), z.boolean()),
  category_scores: z.record(z.string(), z.number().min(0).max(1)),
  category_applied_input_types: z.record(
    z.string(),
    z.array(z.enum(["text", "image"])).default([]),
  ),
});

const responseSchema = z.object({
  model: z.string().min(1),
  results: z.array(resultSchema).length(1),
});

export type OpenAiModerationAdapterOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  cacheTtlMilliseconds?: number;
  cacheProfile?: string;
  embeddedTextEnabled?: boolean;
  resolveInput(
    input: Parameters<ModerationShadowAdapter["inspect"]>[0],
  ): Promise<ModerationProviderInput>;
  fetchImpl?: typeof fetch;
};

export function createOpenAiModerationAdapter(
  options: OpenAiModerationAdapterOptions,
): ModerationShadowAdapter {
  const model = options.model ?? "omni-moderation-2024-09-26";
  const endpoint = options.endpoint ?? "https://api.openai.com/v1/moderations";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    provider: "OPENAI_MODERATION",
    modelName: "omni-moderation",
    modelVersion: model,
    cacheTtlMilliseconds: options.cacheTtlMilliseconds ?? 86_400_000,
    cacheProfile: options.cacheProfile,
    canReuseResult(result) {
      if (!options.embeddedTextEnabled || result.imageCount === 0) return true;
      const parsed = embeddedTextEvidenceSchema.safeParse(result.embeddedText);
      return (
        parsed.success &&
        parsed.data.images.length === result.imageCount &&
        parsed.data.images.every((image) => image.status === "COMPLETE")
      );
    },
    async inspect(target) {
      const input = await options.resolveInput(target);
      const images = input.images ?? (input.image ? [input.image] : []);
      if ((input.images && input.image) || images.length > 2) {
        throw new ModerationProviderCallError("INPUT_UNAVAILABLE", "INVALID_IMAGE_INPUT", false);
      }
      const requestInput: Array<Record<string, unknown>> = [];
      if (input.text) requestInput.push({ type: "text", text: input.text });
      for (const image of images) {
        requestInput.push({ type: "image_url", image_url: { url: image.dataUrl } });
      }
      if (requestInput.length === 0) {
        throw new ModerationProviderCallError(
          "INPUT_UNAVAILABLE",
          "NO_MINIMIZED_PROVIDER_INPUT",
          false,
        );
      }

      const startedAt = performance.now();
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, input: requestInput }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw new ModerationProviderCallError("TIMEOUT", "REQUEST_TIMEOUT", true);
        }
        throw new ModerationProviderCallError("PROVIDER_UNAVAILABLE", "NETWORK_FAILURE", true);
      }

      if (!response.ok) {
        const kind =
          response.status === 429
            ? "RATE_LIMITED"
            : response.status === 401 || response.status === 403
              ? "AUTHENTICATION"
              : response.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "REFUSAL";
        throw new ModerationProviderCallError(
          kind,
          `HTTP_${response.status}`,
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }

      let parsed: z.infer<typeof responseSchema>;
      try {
        parsed = responseSchema.parse(await response.json());
      } catch {
        throw new ModerationProviderCallError("MALFORMED_OUTPUT", "INVALID_RESPONSE_SCHEMA", false);
      }

      const result = parsed.results[0]!;
      if (/\d{4}-\d{2}-\d{2}$/u.test(model) && parsed.model !== model) {
        throw new ModerationProviderCallError("MALFORMED_OUTPUT", "MODEL_SNAPSHOT_MISMATCH", false);
      }
      if (
        Object.keys(result.categories).some((label) => !(label in result.category_scores)) ||
        Object.keys(result.category_scores).some(
          (label) =>
            !(label in result.categories) || !(label in result.category_applied_input_types),
        )
      ) {
        throw new ModerationProviderCallError(
          "MALFORMED_OUTPUT",
          "INCOMPLETE_CATEGORY_EVIDENCE",
          false,
        );
      }
      const signals: ModerationProviderSignal[] = Object.entries(result.category_scores).map(
        ([providerLabel, rawScore]) => ({
          providerLabel,
          canonicalCode: categoryCode[providerLabel] ?? "UNMAPPED_PROVIDER_LABEL",
          rawScore,
          calibratedBand: calibratedBand(rawScore),
          flagged: result.categories[providerLabel] === true,
          appliedModalities: (result.category_applied_input_types[providerLabel] ?? []).map(
            (item) => (item === "image" ? ("IMAGE" as const) : ("TEXT" as const)),
          ),
          regions: [],
        }),
      );
      const supportedLabels = [
        ...new Set(signals.map(({ canonicalCode }) => canonicalCode)),
      ].sort();

      return {
        status: "SUCCEEDED",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        costMicros: 0,
        result: {
          schemaVersion: MODERATION_PROVIDER_RESULT_SCHEMA_VERSION,
          provider: "OPENAI_MODERATION",
          modality: input.modality,
          inputScope: input.scope ?? "UNSPECIFIED",
          imageCount: images.length,
          ...(input.embeddedText
            ? { embeddedText: embeddedTextEvidenceSchema.parse(input.embeddedText) }
            : {}),
          modelSnapshot: parsed.model,
          supportedLabels,
          unsupportedLabels,
          signals,
          abstained: signals.length === 0,
          providerDisagreement: null,
          capabilities: { boundingBoxes: false },
          modalityCoverage: openAiCoverage(signals),
          publicationChanged: false,
        },
      };
    },
  };
}

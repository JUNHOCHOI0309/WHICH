import modelArtifact from "./korean-context-model-v1.json";

export type TextModerationMode = "OFF" | "SHADOW" | "ENFORCE";
export type TextModerationDecision = "ALLOW" | "REVIEW" | "BLOCK";

export type TextModerationInput = {
  target: string;
  context?: string | null;
};

export type TextModerationResult = {
  decision: TextModerationDecision;
  score: number;
  modelVersion: string;
  policyVersion: string;
  thresholds: { review: number; block: number };
};

export interface TextModerator {
  moderate(input: TextModerationInput): TextModerationResult;
}

type ModelArtifact = {
  schemaVersion: number;
  modelVersion: string;
  policyVersion: string;
  dimension: number;
  characterNgrams: [number, number];
  contextCharacterLimit: number;
  contextFeatureWeight: number;
  bridgeFeatureWeight: number;
  weightScale: number;
  weightsBase64Int16Le: string;
  intercept: number;
  thresholds: { review: number; block: number };
};

const artifact = modelArtifact as unknown as ModelArtifact;
const TOKEN_PATTERN = /[0-9a-z가-힣]+|[^\p{L}\p{N}_\s]/giu;
const utf8 = new TextEncoder();
let decodedWeights: Float64Array | undefined;

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

function fnv1a(value: string) {
  let hash = 2166136261;
  for (const byte of utf8.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function weights() {
  if (decodedWeights) return decodedWeights;
  const encoded = Buffer.from(artifact.weightsBase64Int16Le, "base64");
  if (encoded.byteLength !== artifact.dimension * 2) {
    throw new Error("The Korean text moderation model has an invalid weight vector.");
  }
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  decodedWeights = new Float64Array(artifact.dimension);
  for (let index = 0; index < artifact.dimension; index += 1) {
    decodedWeights[index] = view.getInt16(index * 2, true) * artifact.weightScale;
  }
  return decodedWeights;
}

function features(input: TextModerationInput) {
  const target = normalizeText(input.target);
  const contextCharacters = Array.from(normalizeText(input.context ?? ""));
  const context = contextCharacters.slice(-artifact.contextCharacterLimit).join("");
  const values = new Map<number, number>();

  const add = (feature: string, value: number) => {
    const index = fnv1a(feature) & (artifact.dimension - 1);
    values.set(index, (values.get(index) ?? 0) + value);
  };
  const addText = (prefix: "t" | "c", text: string, weight: number) => {
    const characters = Array.from(`^${text}$`);
    for (let size = artifact.characterNgrams[0]; size <= artifact.characterNgrams[1]; size += 1) {
      for (let offset = 0; offset + size <= characters.length; offset += 1) {
        add(`${prefix}:c:${characters.slice(offset, offset + size).join("")}`, weight);
      }
    }
    const tokens = text.match(TOKEN_PATTERN) ?? [];
    const tokenSet = new Set(tokens);
    for (const token of tokenSet) add(`${prefix}:w:${token}`, weight);
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      add(`${prefix}:w2:${tokens[index]}\u241f${tokens[index + 1]}`, weight);
    }
    return tokenSet;
  };

  const targetTokens = addText("t", target, 1);
  if (context) {
    const contextTokens = addText("c", context, artifact.contextFeatureWeight);
    for (const token of targetTokens) {
      if (contextTokens.has(token)) add(`x:shared:${token}`, artifact.bridgeFeatureWeight);
    }
    const contextTail = Array.from(context).slice(-16).join("");
    const targetHead = Array.from(target).slice(0, 16).join("");
    add(`x:bridge:${contextTail}\u241e${targetHead}`, artifact.bridgeFeatureWeight);
  }

  const norm = Math.sqrt([...values.values()].reduce((sum, value) => sum + value * value, 0)) || 1;
  return [...values].map(([index, value]) => [index, value / norm] as const);
}

export function createKoreanContextTextModerator(): TextModerator {
  return {
    moderate(input) {
      const coefficient = weights();
      let logit = artifact.intercept;
      for (const [index, value] of features(input)) logit += coefficient[index]! * value;
      const score = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
      const decision: TextModerationDecision =
        score >= artifact.thresholds.block
          ? "BLOCK"
          : score >= artifact.thresholds.review
            ? "REVIEW"
            : "ALLOW";
      return {
        decision,
        score,
        modelVersion: artifact.modelVersion,
        policyVersion: artifact.policyVersion,
        thresholds: artifact.thresholds,
      };
    },
  };
}

export const koreanContextTextModelMetadata = Object.freeze({
  modelVersion: artifact.modelVersion,
  policyVersion: artifact.policyVersion,
  thresholds: Object.freeze({ ...artifact.thresholds }),
  validation: Object.freeze({ ...modelArtifact.training }),
});

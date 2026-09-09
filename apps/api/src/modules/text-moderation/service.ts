import modelArtifact from "./korean-context-model-v1.json";

export type TextModerationMode = "OFF" | "SHADOW" | "ENFORCE";
export type TextModerationDecision = "ALLOW" | "REVIEW" | "BLOCK";
export type TextModerationDecisionSource = "MODEL" | "HIGH_PRECISION_RULE";
export type HighPrecisionTextRuleId =
  | "DEHUMANIZING_SLUR"
  | "EXPLICIT_SEXUAL_SLUR"
  | "SEXUALIZED_PERSON_REFERENCE"
  | "TARGETED_SEVERE_ABUSE";

export type TextModerationInput = {
  target: string;
  context?: string | null;
};

export type TextModerationResult = {
  decision: TextModerationDecision;
  decisionSource: TextModerationDecisionSource;
  score: number;
  modelVersion: string;
  policyVersion: string;
  ruleId: HighPrecisionTextRuleId | null;
  ruleVersion: string;
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
export const HIGH_PRECISION_TEXT_RULE_VERSION = "korean-high-precision-rules-v1";
const RUNTIME_POLICY_VERSION = "korean-context-text-v2";
const TOKEN_PATTERN = /[0-9a-z가-힣]+|[^\p{L}\p{N}_\s]/giu;
const DISCUSSION_OR_REPORTING_PATTERN =
  /(?:(?:이라는|이란|라고\s*하는).{0,12}(?:말|표현|단어)|(?:욕설|비속어|혐오\s*표현|비하\s*표현|금칙어)(?:입니다|이다|라고|를?\s*(?:인용|예시|신고|탐지|필터|설명))|(?:인용|예시|신고|탐지|필터|교육|연구|분석).{0,20}(?:욕설|비속어|혐오\s*표현|비하\s*표현|금칙어)|낮춰\s*부르는\s*(?:말|표현|비속어))/u;
const EXPLICIT_SEXUAL_SLUR_PATTERN = /(?:자지보지|보지자지|좆|씹물|육변기)/u;
const SEXUALIZED_BODY_PATTERN = /(?:자지|보지)/u;
const SEXUALIZED_PERSON_PATTERN = /(?:사랑|좋아|빨|핥|만지|삽입|넣|성교|섹스|원하|탐하)/u;
const SEXUALIZED_MODIFIER_PATTERN = /(?:섹시|야한|음란|꼴리|성적).{0,10}(?:자지|보지)/u;
const TARGETED_SEVERE_ABUSE_PATTERN =
  /(?:악마새끼|쓰레기새끼|병신새끼|미친놈새끼|개새끼|씹새끼|씨발|느금마|니애미|니엄마)/u;
const DEHUMANIZING_SLUR_PATTERN = /(?:내란견|개돼지|인간쓰레기|벌레새끼|버러지새끼)/u;
const utf8 = new TextEncoder();
let decodedWeights: Float64Array | undefined;

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

function highPrecisionRule(target: string): HighPrecisionTextRuleId | null {
  const normalized = normalizeText(target);
  if (!normalized || DISCUSSION_OR_REPORTING_PATTERN.test(normalized)) return null;
  const compact = normalized.replace(/[\s'"“”‘’()[\]{}.,!?·:_*/\\-]+/gu, "");

  if (DEHUMANIZING_SLUR_PATTERN.test(compact)) return "DEHUMANIZING_SLUR";
  if (TARGETED_SEVERE_ABUSE_PATTERN.test(compact)) return "TARGETED_SEVERE_ABUSE";
  if (EXPLICIT_SEXUAL_SLUR_PATTERN.test(compact) || SEXUALIZED_MODIFIER_PATTERN.test(compact)) {
    return "EXPLICIT_SEXUAL_SLUR";
  }
  if (
    /[0-9a-z가-힣]{1,24}의(?:자지|보지)/u.test(compact) &&
    SEXUALIZED_BODY_PATTERN.test(compact) &&
    SEXUALIZED_PERSON_PATTERN.test(compact)
  ) {
    return "SEXUALIZED_PERSON_REFERENCE";
  }
  return null;
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
      const ruleId = highPrecisionRule(input.target);
      if (ruleId) {
        return {
          decision: "BLOCK",
          decisionSource: "HIGH_PRECISION_RULE",
          score: 1,
          modelVersion: artifact.modelVersion,
          policyVersion: RUNTIME_POLICY_VERSION,
          ruleId,
          ruleVersion: HIGH_PRECISION_TEXT_RULE_VERSION,
          thresholds: artifact.thresholds,
        };
      }
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
        decisionSource: "MODEL",
        score,
        modelVersion: artifact.modelVersion,
        policyVersion: RUNTIME_POLICY_VERSION,
        ruleId: null,
        ruleVersion: HIGH_PRECISION_TEXT_RULE_VERSION,
        thresholds: artifact.thresholds,
      };
    },
  };
}

export const koreanContextTextModelMetadata = Object.freeze({
  modelVersion: artifact.modelVersion,
  modelPolicyVersion: artifact.policyVersion,
  policyVersion: RUNTIME_POLICY_VERSION,
  ruleVersion: HIGH_PRECISION_TEXT_RULE_VERSION,
  thresholds: Object.freeze({ ...artifact.thresholds }),
  validation: Object.freeze({ ...modelArtifact.training }),
});

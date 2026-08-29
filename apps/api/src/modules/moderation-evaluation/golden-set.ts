import { MODERATION_POLICY_VERSION } from "../moderation/policy-registry.js";
import {
  moderationGoldenDatasetSchema,
  type ModerationEvaluationModality,
  type ModerationGoldenCase,
  type ModerationGoldenVerdict,
} from "./contracts.js";

const reviewedAt = "2026-08-29T00:00:00.000Z";

function labeledCase(input: {
  caseId: string;
  modality: ModerationEvaluationModality;
  contentKind: ModerationGoldenCase["contentKind"];
  slices: string[];
  summary: string;
  verdict: ModerationGoldenVerdict;
}): ModerationGoldenCase {
  return {
    caseId: input.caseId,
    modality: input.modality,
    contentKind: input.contentKind,
    cohort: "SMOKE",
    slices: input.slices,
    privateReference: `golden://${input.caseId}`,
    syntheticSummary: input.summary,
    reviews: [
      { reviewerId: "golden-reviewer-a", reviewedAt, verdict: input.verdict, humanWorkflow: null },
      { reviewerId: "golden-reviewer-b", reviewedAt, verdict: input.verdict, humanWorkflow: null },
    ],
  };
}

function humanOnlyCase(input: {
  caseId: string;
  type: "RIGHTS_OWNERSHIP" | "DEFAMATION_VERACITY";
  summary: string;
}): ModerationGoldenCase {
  const humanWorkflow = {
    type: input.type,
    outcome: "PENDING" as const,
    caseReference: `rights-case://${input.caseId}`,
  };
  return {
    caseId: input.caseId,
    modality: "MULTIMODAL",
    contentKind: "ISSUE_MEDIA",
    cohort: "SMOKE",
    slices: ["MULTIMODAL_QUESTION_RELEVANCE"],
    privateReference: `golden://${input.caseId}`,
    syntheticSummary: input.summary,
    reviews: [
      { reviewerId: "golden-reviewer-a", reviewedAt, verdict: null, humanWorkflow },
      { reviewerId: "golden-reviewer-b", reviewedAt, verdict: null, humanWorkflow },
    ],
  };
}

const clear = (reasonCodes: ModerationGoldenVerdict["reasonCodes"] = ["NO_POLICY_VIOLATION"]) =>
  ({ action: "PUBLISHED", reasonCodes, critical: false }) as const;

const review = (reasonCodes: ModerationGoldenVerdict["reasonCodes"], critical = false) =>
  ({ action: "REVIEW", reasonCodes, critical }) as const;

const quarantine = (reasonCodes: ModerationGoldenVerdict["reasonCodes"], critical = false) =>
  ({ action: "QUARANTINED", reasonCodes, critical }) as const;

export const WHICH_100_SMOKE_GOLDEN_SET = moderationGoldenDatasetSchema.parse({
  schemaVersion: 1,
  datasetId: "which-ko-moderation-golden",
  datasetVersion: "which-100-smoke-v1",
  policyVersion: MODERATION_POLICY_VERSION,
  createdAt: reviewedAt,
  cases: [
    labeledCase({
      caseId: "text-normal-disagreement",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_NORMAL_DISAGREEMENT"],
      summary: "정책을 위반하지 않는 강한 반론 문장.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "text-friendly-profanity",
      modality: "TEXT",
      contentKind: "REPLY",
      slices: ["TEXT_FRIENDLY_PROFANITY"],
      summary: "친구 사이 맥락의 비공격적 비속어.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "text-hate-redacted",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_HATE"],
      summary: "보호 집단을 겨냥한 비하 표현이 마스킹된 합성 사례.",
      verdict: quarantine(["HATE"]),
    }),
    labeledCase({
      caseId: "text-threat-redacted",
      modality: "TEXT",
      contentKind: "REPLY",
      slices: ["TEXT_THREAT"],
      summary: "구체적 위해 의도를 암시하되 세부는 제거한 합성 위협 사례.",
      verdict: quarantine(["THREAT"], true),
    }),
    labeledCase({
      caseId: "text-pii-redacted",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_PII"],
      summary: "마스킹된 전화번호와 주소를 노출하는 합성 사례.",
      verdict: quarantine(["PRIVACY"]),
    }),
    labeledCase({
      caseId: "text-spam",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_SPAM"],
      summary: "반복 링크와 무관한 판촉 문구.",
      verdict: review(["SPAM"]),
    }),
    labeledCase({
      caseId: "text-satire",
      modality: "TEXT",
      contentKind: "ISSUE",
      slices: ["TEXT_SATIRE"],
      summary: "특정인을 실제로 위협하지 않는 풍자 문장.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "text-quotation",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_QUOTATION"],
      summary: "비판을 위해 문제 표현을 일부 인용한 맥락.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "text-obfuscated-korean",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_OBFUSCATED_KOREAN"],
      summary: "초성·공백으로 우회한 괴롭힘 표현.",
      verdict: review(["INSULT_OR_HARASSMENT"]),
    }),
    labeledCase({
      caseId: "image-food",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_FOOD"],
      summary: "일반 음식 사진의 합성 메타데이터.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-landscape",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_LANDSCAPE"],
      summary: "사람이 없는 풍경 사진.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-illustration",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_ILLUSTRATION"],
      summary: "비폭력 일반 일러스트.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-anime",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_ANIME"],
      summary: "연령·성적 맥락이 없는 일반 애니메이션 캐릭터.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-skin-false-positive",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_SKIN_EXPOSURE_FALSE_POSITIVE"],
      summary: "수영 경기처럼 피부 노출 오탐 가능성이 있는 안전 이미지.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-pii",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_PII"],
      summary: "마스킹된 연락처가 포함된 합성 이미지.",
      verdict: quarantine(["PRIVACY_PII_DETECTED"]),
    }),
    labeledCase({
      caseId: "image-qr",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_QR"],
      summary: "외부 목적지가 검증되지 않은 QR 코드.",
      verdict: review(["PRIVACY_PII_DETECTED"]),
    }),
    labeledCase({
      caseId: "image-document",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_DOCUMENT"],
      summary: "개인 식별 영역을 마스킹한 문서 스캔 합성 사례.",
      verdict: review(["PRIVACY_PII_DETECTED"]),
    }),
    labeledCase({
      caseId: "image-screenshot",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_SCREENSHOT"],
      summary: "사용자명이 마스킹된 대화 스크린샷.",
      verdict: review(["PRIVACY_IDENTITY_OR_MINOR_UNCERTAIN"]),
    }),
    labeledCase({
      caseId: "image-violence-redacted",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_VIOLENCE"],
      summary: "그래픽 세부를 제거한 폭력 위험 합성 메타데이터.",
      verdict: quarantine(["CONTENT_GRAPHIC_VIOLENCE"], true),
    }),
    labeledCase({
      caseId: "image-sexual-risk-redacted",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_SEXUAL_RISK"],
      summary: "노골적 묘사 없이 성적 위험만 표시한 합성 메타데이터.",
      verdict: quarantine(["SEXUAL"], true),
    }),
    labeledCase({
      caseId: "image-news-politics",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_NEWS_POLITICS"],
      summary: "공개 뉴스 장면이며 위해 요소가 없는 정치 맥락 이미지.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "image-low-light",
      modality: "IMAGE",
      contentKind: "ISSUE_MEDIA",
      slices: ["IMAGE_LOW_LIGHT"],
      summary: "판독이 어려운 저조도 이미지.",
      verdict: review(["OTHER"]),
    }),
    labeledCase({
      caseId: "multi-relevant",
      modality: "MULTIMODAL",
      contentKind: "ISSUE_MEDIA",
      slices: ["MULTIMODAL_QUESTION_RELEVANCE"],
      summary: "질문과 두 선택지를 공정하게 보조하는 이미지 쌍.",
      verdict: clear(),
    }),
    labeledCase({
      caseId: "multi-misleading",
      modality: "MULTIMODAL",
      contentKind: "ISSUE_MEDIA",
      slices: ["MULTIMODAL_MISLEADING_CONTEXT"],
      summary: "질문 의미를 오해하게 만드는 문맥 불일치 이미지.",
      verdict: review(["RELEVANCE_MISLEADING_CONTEXT"]),
    }),
    labeledCase({
      caseId: "multi-information-asymmetry",
      modality: "MULTIMODAL",
      contentKind: "ISSUE_MEDIA",
      slices: ["MULTIMODAL_AB_INFORMATION_ASYMMETRY"],
      summary: "A와 B의 정보량이 크게 다른 이미지 쌍.",
      verdict: review(["VISUAL_MEDIA_ASYMMETRY"]),
    }),
    labeledCase({
      caseId: "multi-crop-asymmetry",
      modality: "MULTIMODAL",
      contentKind: "ISSUE_MEDIA",
      slices: ["MULTIMODAL_CROP_ASYMMETRY"],
      summary: "한 선택지만 불리하게 잘린 이미지 쌍.",
      verdict: review(["VISUAL_CHOICE_BIAS"]),
    }),
    labeledCase({
      caseId: "multi-salience-asymmetry",
      modality: "MULTIMODAL",
      contentKind: "ISSUE_MEDIA",
      slices: ["MULTIMODAL_SALIENCE_ASYMMETRY"],
      summary: "색상·크기 강조가 한 선택지에 편향된 이미지 쌍.",
      verdict: review(["VISUAL_CHOICE_BIAS"]),
    }),
    humanOnlyCase({
      caseId: "human-rights-ownership",
      type: "RIGHTS_OWNERSHIP",
      summary: "저작권 소유 진위를 모델 정답에서 분리한 권리 절차 사례.",
    }),
    humanOnlyCase({
      caseId: "human-defamation-veracity",
      type: "DEFAMATION_VERACITY",
      summary: "명예훼손 진위를 모델 정답에서 분리한 운영 절차 사례.",
    }),
    labeledCase({
      caseId: "text-threat-quoted-safe",
      modality: "TEXT",
      contentKind: "COMMENT",
      slices: ["TEXT_QUOTATION", "TEXT_THREAT"],
      summary: "안전 교육 목적으로 위협 표현을 마스킹 인용한 경계 사례.",
      verdict: clear(),
    }),
  ],
});

import { judgeDecisionSchema, type JudgeDecision } from "../policy-judge/contracts.js";

type JudgeReason = JudgeDecision["reason_codes"][number];

const judgeReasonLabels: Partial<Record<JudgeReason, string>> = {
  SEXUAL: "선정성 기준(노출·성적 표현) 해당 가능성",
  VIOLENCE: "폭력적이거나 잔혹한 표현",
  HATE_HARASSMENT: "혐오·괴롭힘 표현",
  PRIVACY: "개인정보 노출 가능성",
  SPAM: "광고·사기·스팸 가능성",
  RIGHTS_UNCERTAIN: "이미지 사용 권리 불확실",
  IRRELEVANT: "질문·선택지와 이미지의 관련성 부족",
  PAIR_UNFAIR: "A/B 이미지를 공정하게 비교하기 어려움",
  INSUFFICIENT_DETAIL: "화질·정보 부족으로 판정하기 어려움",
  UNCERTAIN: "검사 결과가 불확실함",
};

const genericReviewNote =
  "이미지의 안전성·질문과의 관련성을 충분히 확인하지 못해 공개를 보류했어요. 질문이나 이미지를 수정하거나 이미지 없이 게시할 수 있어요.";

function actionableNote(labels: string[]) {
  const unique = [...new Set(labels)];
  if (!unique.length) return genericReviewNote;
  return `A/B 이미지 중 하나 이상이 게시 기준을 통과하지 못했어요. 확인된 항목: ${unique.join(" · ")}. 이미지를 바꾸거나 이미지 없이 게시해 주세요.`;
}

export function policyJudgeReviewNote(input: unknown) {
  const parsed = judgeDecisionSchema.safeParse(input);
  if (!parsed.success) return genericReviewNote;
  return actionableNote(
    parsed.data.reason_codes.flatMap((reason) => {
      const label = judgeReasonLabels[reason];
      return label ? [label] : [];
    }),
  );
}

export function safetySignalReviewNote(input: unknown) {
  if (!Array.isArray(input)) return genericReviewNote;
  const labels = input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const signal = value as {
      flagged?: boolean;
      canonicalCode?: string;
      providerLabel?: string;
    };
    if (!signal.flagged) return [];
    const code = signal.canonicalCode ?? "";
    const provider = signal.providerLabel ?? "";
    if (code === "SEXUAL") return [judgeReasonLabels.SEXUAL!];
    if (code === "CONTENT_SEXUAL_EXPLOITATION") return ["아동·청소년 관련 성적 콘텐츠"];
    if (
      code === "CONTENT_GRAPHIC_VIOLENCE" ||
      (code === "OTHER" && provider.startsWith("violence"))
    )
      return [judgeReasonLabels.VIOLENCE!];
    if (["HATE", "INSULT_OR_HARASSMENT", "THREAT"].includes(code))
      return [judgeReasonLabels.HATE_HARASSMENT!];
    if (code === "CONTENT_SELF_HARM") return ["자해 관련 유해 콘텐츠"];
    if (code === "ILLEGAL_ACTIVITY") return ["불법·위험 행위 관련 콘텐츠"];
    return ["안전 정책 위반 가능성"];
  });
  return actionableNote(labels);
}

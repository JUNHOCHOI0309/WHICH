import { ImageResponse } from "next/og";

import { readPublicIssueForDiscovery } from "@/lib/server/public-discovery";

export const alt = "WHICH 질문";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const choiceColors = { A: "#0aa9bd", B: "#ff6b35", C: "#8467d7", D: "#5d9c59" } as const;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maximum: number) {
  const normalized = compact(value);
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

export default async function IssueOpenGraphImage({
  params,
}: {
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  const read = uuidPattern.test(issueId)
    ? await readPublicIssueForDiscovery(issueId)
    : { status: "missing" as const };
  const issue = read.status === "available" ? read.value : null;
  const question = truncate(issue?.question ?? "당신의 선택은 어느 쪽인가요?", 64);
  const choices = issue?.choices.map((choice) => ({
    ...choice,
    label: truncate(choice.label, 36),
  })) ?? [
    { code: "A" as const, label: "A 선택" },
    { code: "B" as const, label: "B 선택" },
  ];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 72px",
        background: "#f7f9fa",
        color: "#071b26",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 42, fontWeight: 900 }}>
          <span style={{ color: "#0aa9bd" }}>W</span>HICH
        </div>
        <span style={{ color: "#667783", fontSize: 20 }}>결과는 선택 후 공개</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <span style={{ color: "#0aa9bd", fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>
          {issue?.categoryCode.replaceAll("_", " ") ?? "OPEN QUESTION"}
        </span>
        <span
          style={{
            maxWidth: 1050,
            fontSize: question.length > 42 ? 48 : 58,
            fontWeight: 900,
            lineHeight: 1.12,
          }}
        >
          {question}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {choices.map((choice) => (
          <div
            key={choice.code}
            style={{
              flex: choices.length > 2 ? "1 1 46%" : 1,
              display: "flex",
              alignItems: "center",
              gap: 18,
              border: `3px solid ${choiceColors[choice.code]}`,
              borderRadius: 20,
              padding: choices.length > 2 ? "14px 20px" : "20px 24px",
              fontSize: choices.length > 2 ? 21 : 25,
              fontWeight: 800,
            }}
          >
            <span style={{ color: choiceColors[choice.code] }}>{choice.code}</span>
            <span>{choice.label}</span>
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}

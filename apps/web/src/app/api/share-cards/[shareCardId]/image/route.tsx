import { ImageResponse } from "next/og";

import type { ChoiceCode, PublicShareCard } from "@/lib/contracts";
import { readResultShareCard } from "@/lib/server/result-sharing";

export const runtime = "nodejs";

const RESULT_COLORS: Record<ChoiceCode, string> = {
  A: "#14c8d4",
  B: "#ff8a3d",
  C: "#9b7be8",
  D: "#72b96c",
};

function choiceCount(card: PublicShareCard, code: ChoiceCode) {
  return (
    {
      A: card.result.acceptedA,
      B: card.result.acceptedB,
      C: card.result.acceptedC ?? 0,
      D: card.result.acceptedD ?? 0,
    } satisfies Record<ChoiceCode, number>
  )[code];
}

type RouteContext = { params: Promise<{ shareCardId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { shareCardId } = await context.params;
  const upstream = await readResultShareCard(shareCardId);
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const card = (await upstream.json()) as PublicShareCard;
  const total = card.result.displayedTotal;
  const results = card.issue.choices.map((choice) => ({
    ...choice,
    percent: total === 0 ? 0 : Math.round((choiceCount(card, choice.code) / total) * 100),
  }));

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#061923",
        color: "#f6f8f7",
        padding: "58px 64px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "#14c8d4",
          fontSize: 28,
          fontWeight: 800,
        }}
      >
        <span>WHICH</span>
        <span>RESULT</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <div style={{ fontSize: 54, fontWeight: 900, lineHeight: 1.12, letterSpacing: "-2px" }}>
          {card.issue.question}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          {results.map((choice) => (
            <div
              key={choice.code}
              style={{
                flex: results.length > 2 ? "1 1 46%" : 1,
                display: "flex",
                flexDirection: "column",
                background: RESULT_COLORS[choice.code],
                color: "#061923",
                padding: results.length > 2 ? "16px 22px" : "24px 28px",
              }}
            >
              <span style={{ fontSize: results.length > 2 ? 20 : 24, fontWeight: 800 }}>
                {choice.code} · {choice.label}
              </span>
              <span style={{ fontSize: results.length > 2 ? 40 : 58, fontWeight: 900 }}>
                {choice.percent}%
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", color: "#bfcfd2", fontSize: 22 }}
      >
        <span>{total.toLocaleString("ko-KR")}명 참여</span>
        <span>
          {card.sharedChoiceCode
            ? `공유한 선택 ${card.sharedChoiceCode}`
            : "먼저 고른 뒤 결과를 확인하세요"}
        </span>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

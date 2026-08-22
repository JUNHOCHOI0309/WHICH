import { ImageResponse } from "next/og";

import type { PublicShareCard } from "@/lib/contracts";
import { readResultShareCard } from "@/lib/server/result-sharing";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ shareCardId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { shareCardId } = await context.params;
  const upstream = await readResultShareCard(shareCardId);
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const card = (await upstream.json()) as PublicShareCard;
  const total = card.result.displayedTotal;
  const aPercent = total === 0 ? 0 : Math.round((card.result.acceptedA / total) * 100);
  const bPercent = 100 - aPercent;
  const choiceA = card.issue.choices.find((choice) => choice.code === "A")?.label ?? "A";
  const choiceB = card.issue.choices.find((choice) => choice.code === "B")?.label ?? "B";

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
        <div style={{ display: "flex", gap: 18 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "#14c8d4",
              color: "#061923",
              padding: "24px 28px",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 800 }}>A · {choiceA}</span>
            <span style={{ fontSize: 58, fontWeight: 900 }}>{aPercent}%</span>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "#ff8a3d",
              color: "#061923",
              padding: "24px 28px",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 800 }}>B · {choiceB}</span>
            <span style={{ fontSize: 58, fontWeight: 900 }}>{bPercent}%</span>
          </div>
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

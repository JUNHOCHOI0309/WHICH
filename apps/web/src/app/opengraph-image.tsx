import { ImageResponse } from "next/og";

export const alt = "WHICH — 먼저 고르고, 결과를 확인하세요";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#f7f9fa",
        color: "#071b26",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 52, fontWeight: 900 }}>
        <span style={{ color: "#0aa9bd" }}>W</span>HICH
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <span style={{ color: "#0aa9bd", fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>
          YOUR CHOICE, PRIVATELY.
        </span>
        <span style={{ maxWidth: 950, fontSize: 66, fontWeight: 900, lineHeight: 1.12 }}>
          먼저 고르고, 그다음 사람들의 선택을 확인하세요.
        </span>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 24 }}>
        <span style={{ color: "#0aa9bd" }}>A</span>
        <span>또는</span>
        <span style={{ color: "#ff6b35" }}>B</span>
      </div>
    </div>,
    size,
  );
}

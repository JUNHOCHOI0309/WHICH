import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "WHICH",
  description: "고르고, 결과를 보고, 다음 질문으로.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f7f4ed",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

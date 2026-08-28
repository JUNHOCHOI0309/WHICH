import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/feedback/toast-provider";
import { SITE_DESCRIPTION, SITE_NAME, siteOrigin } from "@/lib/search-discovery";

import "./styles.css";

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  applicationName: SITE_NAME,
  title: {
    default: `${SITE_NAME} — 먼저 고르고, 결과를 확인하세요`,
    template: "%s · WHICH",
  },
  description: SITE_DESCRIPTION,
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — 먼저 고르고, 결과를 확인하세요`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — 먼저 고르고, 결과를 확인하세요`,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F9FA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

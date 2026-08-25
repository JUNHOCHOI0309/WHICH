import type { Metadata } from "next";

import { OpsDashboardExperience } from "@/features/operations/ops-dashboard-experience";

export const metadata: Metadata = {
  title: "운영 콘솔",
  description: "WHICH 운영 상태와 공식 지표를 확인하는 운영자 전용 화면입니다.",
  robots: { index: false, follow: false },
};

export default function OpsPage() {
  return <OpsDashboardExperience />;
}

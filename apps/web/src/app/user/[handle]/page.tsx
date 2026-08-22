import type { Metadata } from "next";

import { CreatorProfileExperience } from "@/features/identity/creator-profile-experience";

export const metadata: Metadata = {
  title: "Creator Profile",
  description: "WHICH에서 이 작성자가 만든 질문을 확인하세요.",
};

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <CreatorProfileExperience handle={handle} />;
}

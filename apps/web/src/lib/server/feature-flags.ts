import { connection } from "next/server";

export async function creatorSubmissionsEnabled() {
  // Deployment settings are only available at runtime, not during image builds.
  await connection();
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.FEATURE_CREATOR_SUBMISSIONS_ENABLED === "true"
  );
}

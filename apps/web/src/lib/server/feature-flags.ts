export function creatorSubmissionsEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.FEATURE_CREATOR_SUBMISSIONS_ENABLED === "true"
  );
}

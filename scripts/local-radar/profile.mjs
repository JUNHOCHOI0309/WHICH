const systemKeys = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "SYSTEMDRIVE",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
]);

/** Build a fresh application environment: never inherit production secrets. */
export function localRadarEnvironment(parent = process.env) {
  const system = Object.fromEntries(
    Object.entries(parent).filter(([key]) => systemKeys.has(key.toUpperCase())),
  );
  return {
    ...system,
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://which_radar:radar_local_only@127.0.0.1:54339/which_radar",
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    API_BASE_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://localhost:3000",
    AUTH_BASE_URL: "http://localhost:3000",
    RELEASE_ID: "radar-local",
    LOG_LEVEL: "info",
    INTERNAL_AUTH_SECRET: "radar-local-only-internal-auth-secret",
    AUTH_INTERNAL_SECRET: "radar-local-only-internal-auth-secret",
    MODERATION_INTERNAL_SECRET: "radar-local-only-moderation-secret",
    AUTH_FLOW_SECRET: "radar-local-only-auth-flow-secret-not-production",
    NEXT_TELEMETRY_DISABLED: "1",
    FEATURE_COMMENTS_ENABLED: "true",
    FEATURE_CREATOR_SUBMISSIONS_ENABLED: "true",
    FEATURE_RESULT_SHARING_ENABLED: "true",
    FEATURE_POINTS_ENABLED: "true",
    FEATURE_ISSUE_MEDIA_ENABLED: "false",
    FEATURE_ML_RANKER_ENABLED: "false",
    FEATURE_NAVER_LOGIN_ENABLED: "false",
    FEATURE_KAKAO_LOGIN_ENABLED: "false",
    FEATURE_TIKTOK_LOGIN_ENABLED: "false",
    AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
    MODERATION_PROVIDER_MODE: "OFF",
    MODERATION_PROVIDER_KILL_SWITCH: "true",
    MODERATION_PROVIDER_DAILY_CALL_CAP: "0",
    MODERATION_PROVIDER_DAILY_COST_MICROS_CAP: "0",
    MODERATION_JOB_DISPATCH_ENABLED: "false",
    MODERATION_WORKER_ENABLED: "false",
    MODERATION_DECISION_MODE: "OFF",
    MODERATION_DECISION_KILL_SWITCH: "true",
    ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH: "true",
    ISSUE_MEMBER_MEDIA_UPLOAD_MODE: "OFF",
    ISSUE_MEDIA_LOCAL_SCANNER_MODE: "OFF",
    POINTS_WORKER_ENABLED: "false",
    POLL_SYNC_ENABLED: "false",
    POLL_SYNC_SCHEDULE_ACTIVE: "false",
    POLL_SYNC_SOURCE_VERIFIED: "false",
    // If this feature is opened locally, fail locally instead of calling the studio.
    MARKETING_STUDIO_COMPLETIONS_URL: "http://127.0.0.1:4000/local-studio-disabled",
  };
}

export function assertNoEnvironmentFiles(names) {
  const unsafe = names.filter(
    (name) => /^\.env(?:\.|$)/i.test(name) && !name.toLowerCase().endsWith(".example"),
  );
  if (unsafe.length)
    throw new Error(
      "Radar local refuses application .env files. Use the isolated worktree without copied credentials.",
    );
}

export function assertLocalRadarDatabase(value) {
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "54339" ||
    url.pathname !== "/which_radar" ||
    url.username !== "which_radar" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Refusing migration/seed outside the dedicated Radar local database");
  }
}

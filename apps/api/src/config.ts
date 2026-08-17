import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const LOCAL_INTERNAL_AUTH_SECRET = "which-local-internal-auth-secret";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  DATABASE_URL: z.string().url().default("postgresql://which:which_local@localhost:54329/which"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INTERNAL_AUTH_SECRET: z.string().min(16).default(LOCAL_INTERNAL_AUTH_SECRET),
  MEMBER_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  FEATURE_COMMENTS_ENABLED: booleanString,
  FEATURE_CREATOR_SUBMISSIONS_ENABLED: booleanString,
  FEATURE_ML_RANKER_ENABLED: booleanString,
  FEATURE_RESULT_SHARING_ENABLED: booleanString,
  FEATURE_RISK_CHALLENGE_ENABLED: booleanString,
});

export type AppConfig = ReturnType<typeof getConfig>;

export function getConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);

  if (
    parsed.NODE_ENV === "production" &&
    parsed.INTERNAL_AUTH_SECRET === LOCAL_INTERNAL_AUTH_SECRET
  ) {
    throw new Error("INTERNAL_AUTH_SECRET must be configured for production.");
  }

  return {
    environment: parsed.NODE_ENV,
    server: {
      host: parsed.API_HOST,
      port: parsed.API_PORT,
      logLevel: parsed.LOG_LEVEL,
      webOrigin: parsed.WEB_ORIGIN,
    },
    databaseUrl: parsed.DATABASE_URL,
    auth: {
      internalSecret: parsed.INTERNAL_AUTH_SECRET,
      memberSessionTtlSeconds: parsed.MEMBER_SESSION_TTL_SECONDS,
      allowDevelopmentProvider: parsed.NODE_ENV !== "production",
    },
    featureFlags: Object.freeze({
      comments: parsed.FEATURE_COMMENTS_ENABLED,
      creatorSubmissions: parsed.FEATURE_CREATOR_SUBMISSIONS_ENABLED,
      mlRanker: parsed.FEATURE_ML_RANKER_ENABLED,
      resultSharing: parsed.FEATURE_RESULT_SHARING_ENABLED,
      riskChallenge: parsed.FEATURE_RISK_CHALLENGE_ENABLED,
      politicalVoting: false,
      politicalComments: false,
    }),
  } as const;
}

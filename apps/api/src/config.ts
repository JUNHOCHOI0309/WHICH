import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const LOCAL_INTERNAL_AUTH_SECRET = "which-local-internal-auth-secret";
const LOCAL_MODERATION_INTERNAL_SECRET = "which-local-moderation-internal-secret";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  // Render and other container platforms provide PORT. Keep API_PORT as an
  // explicit override so local development can continue to use port 4000.
  API_PORT: z.coerce.number().int().positive().max(65_535).optional(),
  PORT: z.coerce.number().int().positive().max(65_535).optional(),
  DATABASE_URL: z.string().url().default("postgresql://which:which_local@localhost:54329/which"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  RELEASE_ID: z.string().min(1).max(128).optional(),
  INTERNAL_AUTH_SECRET: z.string().min(16).default(LOCAL_INTERNAL_AUTH_SECRET),
  MODERATION_INTERNAL_SECRET: z.string().min(16).default(LOCAL_MODERATION_INTERNAL_SECRET),
  MEMBER_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  AUTH_EMAIL_VERIFICATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(604_800)
    .default(86_400),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1_800),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  AUTH_SIGNUP_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_EMAIL_DELIVERY_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
  AUTH_TOKEN_CONSUME_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_EMAIL_VERIFICATION_REQUIRED: booleanString,
  FEATURE_COMMENTS_ENABLED: booleanString,
  FEATURE_CREATOR_SUBMISSIONS_ENABLED: booleanString,
  FEATURE_ML_RANKER_ENABLED: booleanString,
  FEATURE_RESULT_SHARING_ENABLED: booleanString,
  FEATURE_RISK_CHALLENGE_ENABLED: booleanString,
});

export type AppConfig = ReturnType<typeof getConfig>;

export function getConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  const releaseId = parsed.RELEASE_ID ?? environment.RENDER_GIT_COMMIT ?? "local";
  const port = parsed.API_PORT ?? parsed.PORT ?? 4000;

  if (
    parsed.NODE_ENV === "production" &&
    parsed.INTERNAL_AUTH_SECRET === LOCAL_INTERNAL_AUTH_SECRET
  ) {
    throw new Error("INTERNAL_AUTH_SECRET must be configured for production.");
  }
  if (
    parsed.NODE_ENV === "production" &&
    parsed.MODERATION_INTERNAL_SECRET === LOCAL_MODERATION_INTERNAL_SECRET
  ) {
    throw new Error("MODERATION_INTERNAL_SECRET must be configured for production.");
  }
  if (parsed.NODE_ENV === "production" && releaseId === "local") {
    throw new Error("RELEASE_ID must identify the deployed production release.");
  }

  return {
    environment: parsed.NODE_ENV,
    releaseId,
    server: {
      host: parsed.API_HOST,
      port,
      logLevel: parsed.LOG_LEVEL,
      webOrigin: parsed.WEB_ORIGIN,
    },
    databaseUrl: parsed.DATABASE_URL,
    auth: {
      internalSecret: parsed.INTERNAL_AUTH_SECRET,
      moderationInternalSecret: parsed.MODERATION_INTERNAL_SECRET,
      memberSessionTtlSeconds: parsed.MEMBER_SESSION_TTL_SECONDS,
      allowDevelopmentProvider: parsed.NODE_ENV !== "production",
      requireVerifiedEmail: parsed.AUTH_EMAIL_VERIFICATION_REQUIRED,
      security: {
        verificationTtlSeconds: parsed.AUTH_EMAIL_VERIFICATION_TTL_SECONDS,
        passwordResetTtlSeconds: parsed.AUTH_PASSWORD_RESET_TTL_SECONDS,
        rateLimitWindowSeconds: parsed.AUTH_RATE_LIMIT_WINDOW_SECONDS,
        signupLimit: parsed.AUTH_SIGNUP_RATE_LIMIT,
        loginLimit: parsed.AUTH_LOGIN_RATE_LIMIT,
        emailDeliveryLimit: parsed.AUTH_EMAIL_DELIVERY_RATE_LIMIT,
        tokenConsumeLimit: parsed.AUTH_TOKEN_CONSUME_RATE_LIMIT,
      },
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

import { z } from "zod";

export const POLL_SYNC_SCHEDULE = {
  cron: "0 8 * * *",
  timeZone: "Asia/Seoul",
  label: "매일 오전 8시 (한국시간)",
} as const;
const settings = z.object({
  memberId: z.string().uuid(),
  maxPages: z.coerce.number().int().min(1).max(10),
});
export type PollSyncConfig = z.infer<typeof settings>;
export function pollSyncSettings(env: NodeJS.ProcessEnv = process.env) {
  const parsed = settings.safeParse({
    memberId: env.POLL_SYNC_IMPORT_MEMBER_ID,
    maxPages: env.POLL_SYNC_MAX_PAGES ?? "5",
  });
  const configured = parsed.success && env.POLL_SYNC_SOURCE_VERIFIED === "true";
  return {
    configured,
    enabled: configured && env.POLL_SYNC_ENABLED === "true",
    config: parsed.success ? parsed.data : null,
  };
}

export function pollSyncDay(now: Date): string | null {
  const korea = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return korea.getUTCHours() < 8 ? null : korea.toISOString().slice(0, 10);
}

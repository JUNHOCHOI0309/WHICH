import { z } from "zod";

export const POLL_SYNC_SCHEDULE = {
  cron: "0 8 * * *",
  timeZone: "Asia/Seoul",
  label: "매일 오전 8시 (한국시간)",
} as const;
const settings = z.object({
  taskId: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1),
  memberId: z.string().uuid(),
  exportHosts: z.array(z.string().regex(/^(?![\d.]+$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)).min(1),
});
export type PollSyncConfig = z.infer<typeof settings>;
export function pollSyncSettings(env: NodeJS.ProcessEnv = process.env) {
  const parsed = settings.safeParse({
    taskId: env.OCTOPARSE_TASK_ID,
    apiKey: env.OCTOPARSE_API_KEY,
    memberId: env.OCTOPARSE_IMPORT_MEMBER_ID,
    exportHosts: (env.OCTOPARSE_EXPORT_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  });
  const configured = parsed.success && env.OCTOPARSE_MAPPING_VERIFIED === "true";
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

import { z } from "zod";

export function createCloudRunJobStarter(name: string, request: typeof fetch = fetch) {
  const job = z
    .string()
    .regex(/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/)
    .parse(name);
  return async () => {
    const tokenResponse = await request(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      },
    );
    if (!tokenResponse.ok) throw new Error("JOB_IDENTITY_UNAVAILABLE");
    const token = z.object({ access_token: z.string().min(1) }).parse(await tokenResponse.json());
    const response = await request(`https://run.googleapis.com/v2/${job}:run`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("JOB_START_UNCONFIRMED");
    const operation = (await response.json()) as { name?: string; error?: unknown };
    if (!operation.name || operation.error) throw new Error("JOB_START_UNCONFIRMED");
  };
}

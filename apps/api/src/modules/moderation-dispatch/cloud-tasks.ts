import { z } from "zod";

type ClaimedWakeup = {
  id: string;
  claimToken: string | null;
};

const claimedWakeupSchema = z.object({ id: z.uuid(), claimToken: z.uuid() });
const queueSchema = z
  .string()
  .regex(/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-z0-9-]+$/);
const serviceAccountSchema = z.string().regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/);

function trustedWorkerUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".run.app") ||
    url.pathname !== "/" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("MODERATION_TASK_WORKER_URL_INVALID");
  }
  return url;
}

async function metadataToken(request: typeof fetch) {
  const response = await request(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error("TASK_IDENTITY_UNAVAILABLE");
  return z.object({ access_token: z.string().min(1) }).parse(await response.json()).access_token;
}

export function createCloudTasksStarter(
  input: {
    queue: string;
    workerUrl: string;
    serviceAccountEmail: string;
  },
  request: typeof fetch = fetch,
) {
  const queue = queueSchema.parse(input.queue);
  const workerUrl = trustedWorkerUrl(input.workerUrl);
  const serviceAccountEmail = serviceAccountSchema.parse(input.serviceAccountEmail);
  const target = new URL("moderate", workerUrl).toString();

  return async (events: ClaimedWakeup[]) => {
    if (!events.length) return;
    const claimedEvents = z.array(claimedWakeupSchema).max(100).parse(events);
    const token = await metadataToken(request);
    const responses = await Promise.all(
      claimedEvents.map(async (event) => {
        const taskId = `moderation-${event.id}-${event.claimToken}`;
        const response = await request(`https://cloudtasks.googleapis.com/v2/${queue}/tasks`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            task: {
              name: `${queue}/tasks/${taskId}`,
              dispatchDeadline: "300s",
              httpRequest: {
                httpMethod: "POST",
                url: target,
                headers: { "content-type": "application/json" },
                oidcToken: {
                  serviceAccountEmail,
                  audience: workerUrl.origin,
                },
                body: Buffer.from(
                  JSON.stringify({ eventId: event.id, claimToken: event.claimToken }),
                ).toString("base64"),
              },
            },
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        // A deterministic task name makes a confirmed duplicate equivalent to accepted delivery.
        if (!response.ok && response.status !== 409) throw new Error("TASK_CREATE_UNCONFIRMED");
      }),
    );
    return { created: responses.length };
  };
}

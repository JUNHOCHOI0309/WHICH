import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createCloudTasksStarter } from "../src/modules/moderation-dispatch/cloud-tasks.js";

describe("Cloud Tasks moderation transport", () => {
  it("creates one authenticated content-free task per claimed wakeup", async () => {
    const eventId = randomUUID();
    const claimToken = randomUUID();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "metadata-token" }))
      .mockResolvedValueOnce(Response.json({ name: "task" }, { status: 200 }));
    const start = createCloudTasksStarter(
      {
        queue: "projects/test/locations/asia-southeast1/queues/moderation",
        workerUrl: "https://moderation-worker-project.asia-southeast1.run.app/",
        serviceAccountEmail: "worker@test.iam.gserviceaccount.com",
      },
      request,
    );

    await expect(start([{ id: eventId, claimToken }])).resolves.toEqual({ created: 1 });
    expect(request).toHaveBeenCalledTimes(2);
    const rawBody = request.mock.calls[1]![1]?.body;
    expect(typeof rawBody).toBe("string");
    if (typeof rawBody !== "string") throw new Error("EXPECTED_JSON_TASK_BODY");
    const body = z
      .object({
        task: z.object({
          name: z.string(),
          httpRequest: z.object({
            httpMethod: z.string(),
            url: z.string(),
            oidcToken: z.object({
              audience: z.string(),
              serviceAccountEmail: z.string(),
            }),
            body: z.string(),
          }),
        }),
      })
      .parse(JSON.parse(rawBody) as unknown);
    expect(body.task.name).toContain(`${eventId}-${claimToken}`);
    expect(body.task.httpRequest).toMatchObject({
      httpMethod: "POST",
      url: "https://moderation-worker-project.asia-southeast1.run.app/moderate",
      oidcToken: {
        audience: "https://moderation-worker-project.asia-southeast1.run.app",
        serviceAccountEmail: "worker@test.iam.gserviceaccount.com",
      },
    });
    expect(JSON.parse(Buffer.from(body.task.httpRequest.body, "base64").toString("utf8"))).toEqual({
      eventId,
      claimToken,
    });
    expect(rawBody).not.toContain("question");
  });

  it("accepts a deterministic duplicate and rejects untrusted configuration", async () => {
    expect(() =>
      createCloudTasksStarter({
        queue: "projects/test/locations/region/queues/moderation",
        workerUrl: "https://evil.example/",
        serviceAccountEmail: "worker@test.iam.gserviceaccount.com",
      }),
    ).toThrow("MODERATION_TASK_WORKER_URL_INVALID");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "metadata-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const start = createCloudTasksStarter(
      {
        queue: "projects/test/locations/region/queues/moderation",
        workerUrl: "https://worker-project.region.run.app/",
        serviceAccountEmail: "worker@test.iam.gserviceaccount.com",
      },
      request,
    );
    await expect(start([{ id: randomUUID(), claimToken: randomUUID() }])).resolves.toEqual({
      created: 1,
    });
  });
});

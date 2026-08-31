import { describe, expect, it, vi } from "vitest";
import { createCloudRunJobStarter } from "../src/modules/moderation-dispatch/cloud-run-job.js";
import { submissionWakeup } from "../src/modules/moderation-dispatch/submission-wakeup-event.js";

describe("Cloud Run submission job transport", () => {
  it("uses service identity and fixed job config without sending content or overrides", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "test-token" }))
      .mockResolvedValueOnce(
        Response.json({ name: "projects/test/locations/asia-southeast1/operations/op" }),
      );
    await createCloudRunJobStarter(
      "projects/test/locations/asia-southeast1/jobs/moderation",
      request,
    )();
    expect(request.mock.calls[0]![0]).toBe(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    );
    expect(request.mock.calls[1]![0]).toBe(
      "https://run.googleapis.com/v2/projects/test/locations/asia-southeast1/jobs/moderation:run",
    );
    expect(request.mock.calls[1]![1]).toMatchObject({ body: "{}", redirect: "error" });
  });
  it("rejects untrusted job endpoints and does not retry ambiguous requests", async () => {
    expect(() => createCloudRunJobStarter("https://evil.example/job")).toThrow();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "test" }))
      .mockRejectedValueOnce(new Error("timeout"));
    await expect(
      createCloudRunJobStarter("projects/test/locations/region/jobs/job", request)(),
    ).rejects.toThrow("timeout");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("only creates a deterministic private wakeup once a pair is attached", () => {
    expect(submissionWakeup("id", 1, false)).toEqual([]);
    expect(submissionWakeup("id", 2, true)).toEqual(submissionWakeup("id", 2, true));
    expect(submissionWakeup("id", 2, true)[0]!.payload).toEqual({
      submissionId: "id",
      revision: 2,
    });
  });
});

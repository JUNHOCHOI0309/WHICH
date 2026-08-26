import { describe, expect, it } from "vitest";

import {
  issueMediaTreatmentEnabled,
  issueMediaViewerKey,
} from "../src/modules/issues/media-experiment.js";

const publicUrl = (key: string) => `https://media.example/${key}`;

describe("Issue media exposure assignment", () => {
  it("defaults to TEXT_ONLY without an enabled flag, viewer, public storage, or rollout", () => {
    expect(issueMediaTreatmentEnabled(undefined, "guest:1", "issue-1")).toBe(false);
    expect(
      issueMediaTreatmentEnabled({ enabled: true, exposurePercent: 100 }, "guest:1", "issue-1"),
    ).toBe(false);
    expect(
      issueMediaTreatmentEnabled(
        { enabled: true, exposurePercent: 100, publicUrl },
        undefined,
        "issue-1",
      ),
    ).toBe(false);
    expect(
      issueMediaTreatmentEnabled(
        { enabled: true, exposurePercent: 0, publicUrl },
        "guest:1",
        "issue-1",
      ),
    ).toBe(false);
  });

  it("assigns the same viewer and Issue deterministically", () => {
    const options = { enabled: true, exposurePercent: 37, publicUrl };
    const first = issueMediaTreatmentEnabled(options, "guest:stable", "issue-1");
    expect(issueMediaTreatmentEnabled(options, "guest:stable", "issue-1")).toBe(first);
  });

  it("supports an explicit 100 percent treatment rollout", () => {
    expect(
      issueMediaTreatmentEnabled(
        { enabled: true, exposurePercent: 100, publicUrl },
        "guest:stable",
        "issue-1",
      ),
    ).toBe(true);
  });

  it("prefers the Member session when both viewer identities are available", () => {
    expect(
      issueMediaViewerKey({ anonymousSubjectId: "guest-id", sessionToken: "member-session" }),
    ).toBe("member:member-session");
    expect(issueMediaViewerKey({ anonymousSubjectId: "guest-id" })).toBe("guest:guest-id");
  });
});

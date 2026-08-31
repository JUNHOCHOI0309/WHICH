import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SubmissionFeedbackProvider,
  trackSubmission,
  forgetSubmission,
} from "@/features/issues/submission-feedback";
import { submissionOutcome } from "@/features/issues/submission-outcome";
import type { MemberIssueSubmission } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/features/issues/issue-creator-client", () => ({ loadMemberSubmission: mocks.load }));
vi.mock("@/components/feedback/toast-provider", () => ({ toast: mocks }));
const pending = {
  id: "submission-1",
  revision: 2,
  status: "PENDING",
  publicationState: "PROCESSING",
  publishedIssueId: null,
} as MemberIssueSubmission;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.load.mockResolvedValue(pending);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
describe("submission outcome feedback", () => {
  it("does not duplicate a toast already displayed by a text/library action", async () => {
    trackSubmission(pending);
    render(
      <SubmissionFeedbackProvider>
        <p>page</p>
      </SubmissionFeedbackProvider>,
    );
    await tick();
    forgetSubmission(pending.id);
    mocks.load.mockResolvedValue({
      ...pending,
      status: "APPROVED",
      publicationState: "PUBLISHED",
      publishedIssueId: "live",
    });
    await tick(10000);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("keeps tracking after composer/page children change and announces real publication once", async () => {
    const view = render(
      <SubmissionFeedbackProvider>
        <p>composer</p>
      </SubmissionFeedbackProvider>,
    );
    trackSubmission(pending);
    await tick();
    expect(mocks.success).not.toHaveBeenCalled();
    view.rerender(
      <SubmissionFeedbackProvider>
        <p>other page</p>
      </SubmissionFeedbackProvider>,
    );
    mocks.load.mockResolvedValue({
      ...pending,
      status: "APPROVED",
      publicationState: "PUBLISHED",
      publishedIssueId: "live",
    });
    await tick(5000);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    view.unmount();
    render(
      <SubmissionFeedbackProvider>
        <p>remount</p>
      </SubmissionFeedbackProvider>,
    );
    await tick(30000);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("which:pending-submissions:v1")).toBeNull();
  });
  it("ignores an older revision and reports only a current failed outcome", async () => {
    render(
      <SubmissionFeedbackProvider>
        <p>page</p>
      </SubmissionFeedbackProvider>,
    );
    trackSubmission(pending);
    mocks.load.mockResolvedValue({
      ...pending,
      revision: 1,
      status: "REJECTED",
      publicationState: "REJECTED",
    });
    await tick();
    expect(mocks.error).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue({
      ...pending,
      status: "NEEDS_CHANGES",
      publicationState: "NEEDS_CHANGES",
    });
    await tick(5000);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
  it("does not turn network errors or long processing into rejection", async () => {
    trackSubmission(pending);
    mocks.load.mockRejectedValue(new Error("Network unavailable"));
    render(
      <SubmissionFeedbackProvider>
        <p>page</p>
      </SubmissionFeedbackProvider>,
    );
    await tick(5 * 60000);
    expect(mocks.error).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue(pending);
    await tick(5000);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it.each([null, { ...pending, status: "CANCELLED", publicationState: "CANCELLED" }])(
    "stops silently for missing/foreign or cancelled submission",
    async (result) => {
      trackSubmission(pending);
      mocks.load.mockResolvedValue(result);
      render(
        <SubmissionFeedbackProvider>
          <p>page</p>
        </SubmissionFeedbackProvider>,
      );
      await tick();
      await tick(15000);
      expect(mocks.load).toHaveBeenCalledTimes(1);
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );
  it("stops on session expiry without reporting a publication failure", async () => {
    trackSubmission(pending);
    mocks.load.mockRejectedValue({ status: 401 });
    render(
      <SubmissionFeedbackProvider>
        <p>page</p>
      </SubmissionFeedbackProvider>,
    );
    await tick();
    await tick(10000);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it("does not interpret an approval without a public issue as published", () => {
    expect(submissionOutcome({ ...pending, status: "APPROVED" })).toBe("processing");
    expect(submissionOutcome({ ...pending, publicationState: "PUBLISHED" })).toBe("processing");
    expect(
      submissionOutcome({ ...pending, publishedIssueId: "live", publicationState: "QUARANTINED" }),
    ).toBe("failed");
  });
});

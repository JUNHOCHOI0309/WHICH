import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsReportedMembersPanel } from "@/features/operations/ops-reported-members-panel";

afterEach(() => vi.unstubAllGlobals());

describe("Ops reported Member management", () => {
  it("shows report signals and opens the moderation queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            generatedAt: "2026-09-02T02:00:00.000Z",
            items: [
              {
                memberId: "20503719-4d3b-4abf-a1ee-ec0920d72e9a",
                displayName: "reported-maker",
                memberStatus: "ACTIVE",
                reports7d: 4,
                uniqueReporters7d: 3,
                reportedTargets7d: 2,
                reports14d: 6,
                uniqueReporters14d: 5,
                reportedTargets14d: 3,
                latestReportAt: "2026-09-02T01:00:00.000Z",
                issueAccess: {
                  policyVersion: "which-member-issue-access-v1",
                  state: "BLOCKED",
                  canCreateNow: false,
                  canStartUpload: false,
                  reasonCode: "REPORT_COOLDOWN",
                  restrictedUntil: "2026-09-05T01:00:00.000Z",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const onOpenModeration = vi.fn();

    render(<OpsReportedMembersPanel onOpenModeration={onOpenModeration} />);

    expect(await screen.findByText("reported-maker")).toBeVisible();
    expect(screen.getByText("BLOCKED")).toBeVisible();
    expect(screen.getByText(/신고 4 · 신고자 3/)).toBeVisible();
    expect(screen.getByText(/신고 6 · 신고자 5/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "신고 검토 큐 열기" }));
    expect(onOpenModeration).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OpsMediaReviewPanel,
  reviewActionsForStatus,
} from "@/features/operations/ops-media-review-panel";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Ops media review state controls", () => {
  it("exposes only valid actions for each effective state", () => {
    expect(reviewActionsForStatus("PENDING")).toEqual(["APPROVED", "REJECTED", "DELETED"]);
    expect(reviewActionsForStatus("APPROVED")).toEqual(["HIDDEN", "DELETED"]);
    expect(reviewActionsForStatus("HIDDEN")).toEqual(["RESTORED", "DELETED"]);
    expect(reviewActionsForStatus("REJECTED")).toEqual(["DELETED"]);
    expect(reviewActionsForStatus("DELETED")).toEqual([]);
  });

  it("replaces a purged preview and removes all unavailable controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("rights-requests")) return response({ items: [] });
        return response({
          schemaVersion: 1,
          generatedAt: "2026-08-26T00:00:00.000Z",
          counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, HIDDEN: 0, DELETED: 1 },
          items: [
            {
              id: "asset-deleted",
              sha256: "hash",
              perceptualHash: null,
              input: { mimeType: "image/png", byteSize: 100, width: 100, height: 100 },
              output: { mimeType: "image/webp", byteSize: 80, width: 100, height: 100 },
              effectiveStatus: "DELETED",
              rightsState: "ASSERTED",
              rightsAttestation: "테스트 이미지에 대한 사용 권한을 확인했습니다.",
              rightsAttestedAt: "2026-08-26T00:00:00.000Z",
              uploadedBy: "operator",
              publishedUrl: null,
              link: null,
              latestDecision: null,
              history: [],
              createdAt: "2026-08-26T00:00:00.000Z",
              updatedAt: "2026-08-26T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    render(<OpsMediaReviewPanel />);

    expect(await screen.findByText("삭제된 이미지입니다.")).toBeVisible();
    expect(screen.queryByAltText("운영 검수 이미지")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복구" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저작권 요청" })).not.toBeInTheDocument();
    expect(screen.getByText(/추가 검수·권리 조작을 실행할 수 없습니다/)).toBeVisible();
  });

  it("applies asset search only on submit without reloading unrelated data", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("rights-requests")) return response({ items: [] });
      if (url.includes("media-library")) return response({ items: [] });
      return response({
        schemaVersion: 1,
        generatedAt: "2026-08-26T00:00:00.000Z",
        counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, HIDDEN: 0, DELETED: 0 },
        items: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsMediaReviewPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const search = screen.getByPlaceholderText("Asset ID, SHA-256, 권리 근거 검색");
    fireEvent.change(search, { target: { value: "asset-123" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "조회" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ops/media-review/assets?q=asset-123",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});

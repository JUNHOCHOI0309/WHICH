import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsPointShopPanel } from "@/features/operations/ops-point-shop-panel";

const item = {
  id: "10503719-4d3b-4abf-a1ee-ec0920d72e9a",
  code: "PAPER_VOTE_ACCENT",
  equipSlot: "PROFILE_ACCENT" as const,
  themeFamily: "PAPER_VOTE" as const,
  name: "Paper Vote Accent",
  description: "운영 상태 변경 테스트 상품입니다.",
  price: 500,
  status: "ACTIVE" as "ACTIVE" | "PAUSED",
  currentVersion: 1,
  purchaseCount: 0,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function pointShopView() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-29T00:00:00.000Z",
    counts: {
      ACTIVE: item.status === "ACTIVE" ? 1 : 0,
      PAUSED: item.status === "PAUSED" ? 1 : 0,
      RETIRED: 0,
    },
    items: [{ ...item }],
    audit: [],
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Ops Point Shop status controls", () => {
  it("saves a status-only change with an automatic audit reason", async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { status: string; reason: string };
        expect(body).toMatchObject({
          status: "PAUSED",
          reason: "판매 상태 변경: 판매 중 → 판매 중지",
        });
        item.status = "PAUSED";
        item.updatedAt = "2026-08-29T00:01:00.000Z";
        return jsonResponse({ ...item });
      }
      return jsonResponse(pointShopView());
    });
    vi.stubGlobal("fetch", request);

    render(<OpsPointShopPanel />);

    const status = await screen.findByRole("combobox", { name: "판매 상태" });
    fireEvent.change(status, { target: { value: "PAUSED" } });
    fireEvent.click(screen.getByRole("button", { name: "판매 상태 저장" }));

    expect(await screen.findByText("Paper Vote Accent의 판매 상태를 저장했습니다.")).toBeVisible();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("combobox", { name: "판매 상태" })).toHaveValue("PAUSED");
  });
});

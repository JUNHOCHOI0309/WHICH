import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyWebhook = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: verifyWebhook };
  },
}));

import { POST } from "@/app/api/webhooks/resend/route";

const receivedEvent = {
  type: "email.received" as const,
  created_at: "2026-08-29T08:00:01.000Z",
  data: {
    email_id: "email_support_001",
    created_at: "2026-08-29T08:00:00.000Z",
    from: "sender@example.com",
    to: ["support@which.site"],
    bcc: [],
    cc: [],
    received_for: ["support@which.site"],
    message_id: "<support-001@example.com>",
    subject: "  서비스   문의  ",
    attachments: [
      {
        id: "attachment-1",
        filename: "private-document.pdf",
        content_type: "application/pdf",
        content_disposition: "attachment",
        content_id: null,
      },
    ],
  },
};

function webhookRequest() {
  return new NextRequest("https://whichone.site/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_support_webhook_001",
      "svix-timestamp": "1787990400",
      "svix-signature": "v1,test-signature",
    },
    body: JSON.stringify(receivedEvent),
  });
}

describe("Resend inbound webhook", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test_signing_secret");
    vi.stubEnv("RESEND_INBOUND_SUPPORT_ADDRESS", "support@which.site");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "webhook-test-internal-secret");
    verifyWebhook.mockReturnValue(receivedEvent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("verifies and forwards only bounded email metadata", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/internal/ops/support-email-events");
      expect(new Headers(init?.headers).get("x-internal-auth-secret")).toBe(
        "webhook-test-internal-secret",
      );
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        eventId: "msg_support_webhook_001",
        emailId: "email_support_001",
        sender: "sender@example.com",
        recipient: "support@which.site",
        subject: "서비스 문의",
        attachmentCount: 1,
      });
      expect(JSON.stringify(body)).not.toContain("private-document.pdf");
      return Response.json({ status: "RECORDED" });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, status: "RECORDED" });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid signature without contacting the API", async () => {
    verifyWebhook.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await POST(webhookRequest());
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("acknowledges unrelated recipients without storing their metadata", async () => {
    verifyWebhook.mockReturnValue({
      ...receivedEvent,
      data: { ...receivedEvent.data, to: ["other@which.site"] },
    });
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, ignored: true });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when the API cannot persist the event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    const response = await POST(webhookRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "SUPPORT_EMAIL_INGEST_FAILED" });
  });
});

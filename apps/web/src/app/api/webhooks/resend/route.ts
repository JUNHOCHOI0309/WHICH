import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { internalAuthSecret } from "@/lib/server/member-auth";
import { fetchWhichApi } from "@/lib/server/which-api";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 256 * 1024;

function supportAddress() {
  return (process.env.RESEND_INBOUND_SUPPORT_ADDRESS ?? process.env.SUPPORT_EMAIL ?? "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function compact(value: string, maximumLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function validDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const recipient = supportAddress();
  if (!webhookSecret || !recipient) {
    return NextResponse.json(
      { code: "RESEND_WEBHOOK_UNAVAILABLE", message: "Inbound email is not configured." },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json(
      { code: "PAYLOAD_TOO_LARGE", message: "The webhook payload is too large." },
      { status: 413 },
    );
  }

  const eventId = request.headers.get("svix-id")?.trim();
  const timestamp = request.headers.get("svix-timestamp")?.trim();
  const signature = request.headers.get("svix-signature")?.trim();
  if (!eventId || !timestamp || !signature) {
    return NextResponse.json(
      { code: "INVALID_WEBHOOK", message: "The webhook signature headers are missing." },
      { status: 400 },
    );
  }

  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json(
      { code: "PAYLOAD_TOO_LARGE", message: "The webhook payload is too large." },
      { status: 413 },
    );
  }

  let event: ReturnType<Resend["webhooks"]["verify"]>;
  try {
    event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: { id: eventId, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return NextResponse.json(
      { code: "INVALID_WEBHOOK", message: "The webhook signature is invalid." },
      { status: 400 },
    );
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ accepted: true, ignored: true });
  }

  const matchingRecipient = event.data.to.find(
    (address) => address.trim().toLocaleLowerCase("en-US") === recipient,
  );
  if (!matchingRecipient) {
    return NextResponse.json({ accepted: true, ignored: true });
  }

  const receivedAt = validDateTime(event.data.created_at);
  if (!receivedAt) {
    return NextResponse.json(
      { code: "INVALID_WEBHOOK", message: "The received email metadata is invalid." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/internal/ops/support-email-events", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-internal-auth-secret": internalAuthSecret(),
      },
      body: JSON.stringify({
        eventId: compact(eventId, 128),
        emailId: compact(event.data.email_id, 128),
        messageId: event.data.message_id ? compact(event.data.message_id, 500) : null,
        sender: compact(event.data.from, 320),
        recipient,
        subject: compact(event.data.subject, 300),
        receivedAt,
        attachmentCount: Math.min(event.data.attachments.length, 100),
      }),
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { code: "SUPPORT_EMAIL_INGEST_FAILED", message: "The email event was not recorded." },
        { status: 502 },
      );
    }
    const result = (await upstream.json()) as { status: "RECORDED" | "REPLAYED" };
    return NextResponse.json({ accepted: true, status: result.status });
  } catch {
    return NextResponse.json(
      { code: "SUPPORT_EMAIL_INGEST_FAILED", message: "The email event was not recorded." },
      { status: 502 },
    );
  }
}

import { createHmac } from "node:crypto";

import type { OutboxDeliveryEvent, OutboxTransport } from "./contracts.js";

export type HttpOutboxTransportOptions = {
  url: string;
  secret: string;
  timeoutMilliseconds: number;
  fetch?: typeof globalThis.fetch;
};

export function createHttpOutboxTransport(options: HttpOutboxTransportOptions): OutboxTransport {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async deliver(event: OutboxDeliveryEvent) {
      const body = JSON.stringify(event.payload);
      const signature = createHmac("sha256", options.secret).update(body).digest("hex");
      const response = await fetchImplementation(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-which-event-id": event.id,
          "x-which-event-type": event.eventType,
          "x-which-schema-version": String(event.schemaVersion),
          "x-which-delivery-attempt": String(event.totalAttemptCount),
          "x-which-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMilliseconds),
      });

      if (!response.ok) {
        throw new Error(`Outbox Webhook returned HTTP ${response.status} ${response.statusText}.`);
      }
    },
  };
}

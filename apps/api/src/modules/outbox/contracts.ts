export type OutboxDeliveryEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attemptCount: number;
  totalAttemptCount: number;
  claimToken: string;
};

export type OutboxPublishSummary = {
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
  staleClaims: number;
};

export type OutboxDeadLetter = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: Date;
  attemptCount: number;
  totalAttemptCount: number;
  requeueCount: number;
  deadLetteredAt: Date;
  lastError: string | null;
};

export type OutboxRequeueResult = {
  id: string;
  status: "PENDING";
  attemptCount: number;
  totalAttemptCount: number;
  requeueCount: number;
  availableAt: Date;
};

export interface OutboxTransport {
  deliver(event: OutboxDeliveryEvent): Promise<void>;
}

export interface OutboxPublisherService {
  claimBatch(limit?: number): Promise<OutboxDeliveryEvent[]>;
  processBatch(limit?: number): Promise<OutboxPublishSummary>;
  listDeadLetters(limit?: number): Promise<OutboxDeadLetter[]>;
  requeueDeadLetter(eventId: string): Promise<OutboxRequeueResult | null>;
}

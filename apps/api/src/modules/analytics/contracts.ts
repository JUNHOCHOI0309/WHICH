export const ANALYTICS_EVENT_TYPES = [
  "ISSUE_VIEWABLE_IMPRESSION",
  "VOTE_SUBMIT",
  "RESULT_VIEW",
  "NEXT_ISSUE_OPEN",
  "NEXT_ISSUE_EXHAUSTED",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export type AcquisitionAttribution = {
  source: "naver";
  medium: "choice" | "cafe" | "clip_blog" | "blog_search" | "homefeed_da" | "lounge" | "band";
  campaign?: string;
  content?: string;
  capturedAt: string;
};

export type AnalyticsEventCommand = {
  eventId: string;
  sessionId: string;
  eventType: AnalyticsEventType;
  issueId: string;
  issueVersion: number;
  occurredAt: string;
  attribution?: AcquisitionAttribution;
};

export type AnalyticsEventResult = { accepted: true; duplicate: boolean };

export interface AnalyticsService {
  recordEvent(command: AnalyticsEventCommand): Promise<AnalyticsEventResult>;
}

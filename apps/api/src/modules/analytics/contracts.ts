export const ANALYTICS_EVENT_TYPES = [
  "ISSUE_VIEWABLE_IMPRESSION",
  "VOTE_SUBMIT",
  "RESULT_VIEW",
  "NEXT_ISSUE_OPEN",
  "NEXT_ISSUE_EXHAUSTED",
  "INTEREST_PROMPT_VIEW",
  "INTEREST_SELECTION_COMPLETE",
  "INTEREST_PROMPT_SKIP",
  "INTEREST_PROFILE_RESET",
  "PERSONALIZED_FEED_VIEW",
  "PERSONALIZED_ISSUE_OPEN",
  "SHARE_OPEN",
  "SHARE_CHOICE_TOGGLE",
  "SHARE_COMPLETE",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const ANALYTICS_ENTRY_SURFACES = [
  "HOME",
  "EXTERNAL",
  "DIRECT_ISSUE",
  "NATIVE",
  "UNKNOWN",
] as const;
export const ANALYTICS_AUDIENCE_SEGMENTS = ["GUEST", "MEMBER", "UNKNOWN"] as const;
export const ANALYTICS_DEVICE_SEGMENTS = ["MOBILE", "TABLET", "DESKTOP", "UNKNOWN"] as const;
export const ANALYTICS_TRAFFIC_CLASSES = [
  "PRODUCT",
  "TEST",
  "OPERATOR",
  "BOT",
  "UNCLASSIFIED",
] as const;

export type AnalyticsSessionContext = {
  entrySurface: (typeof ANALYTICS_ENTRY_SURFACES)[number];
  audienceSegment: (typeof ANALYTICS_AUDIENCE_SEGMENTS)[number];
  deviceSegment: (typeof ANALYTICS_DEVICE_SEGMENTS)[number];
  trafficClass: (typeof ANALYTICS_TRAFFIC_CLASSES)[number];
};

export type AcquisitionAttribution =
  | {
      source: "naver";
      medium: "choice" | "cafe" | "clip_blog" | "blog_search" | "homefeed_da" | "lounge" | "band";
      campaign?: string;
      content?: string;
      capturedAt: string;
    }
  | {
      source: "share";
      medium: "copy" | "system" | "x";
      campaign: "result" | "result_with_choice";
      content: string;
      capturedAt: string;
    };

export type AnalyticsEventCommand = {
  eventId: string;
  sessionId: string;
  eventType: AnalyticsEventType;
  issueId: string;
  issueVersion: number;
  recommendationRequestId?: string;
  shareCardId?: string;
  occurredAt: string;
  attribution?: AcquisitionAttribution;
  context?: AnalyticsSessionContext;
};

export type AnalyticsEventResult = { accepted: true; duplicate: boolean };

export interface AnalyticsService {
  recordEvent(command: AnalyticsEventCommand): Promise<AnalyticsEventResult>;
}

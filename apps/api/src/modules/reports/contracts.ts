export const CONTENT_REPORT_TARGETS = ["ISSUE", "ISSUE_MEDIA"] as const;
export type ContentReportTarget = (typeof CONTENT_REPORT_TARGETS)[number];

export const CONTENT_REPORT_REASONS = [
  "SPAM",
  "INSULT_OR_HARASSMENT",
  "HATE",
  "THREAT",
  "PRIVACY",
  "SEXUAL",
  "IMPERSONATION",
  "ILLEGAL_ACTIVITY",
  "OTHER",
] as const;
export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];

export type ContentReportCommand = {
  targetType: ContentReportTarget;
  targetId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  idempotencyKey: string;
  reasonCode: ContentReportReason;
  detail?: string;
};

export type ContentReportResult = {
  httpStatus: 201;
  body: {
    report: { id: string; accepted: true; counted: true };
    case: {
      id: string;
      status: "OPEN" | "PENDING_REVIEW" | "QUARANTINED";
      priority: "NORMAL" | "P0";
      automationRecommendation: "NONE" | "P0_REVIEW" | "QUARANTINE_REVIEW";
    };
    signals: {
      reporterCount: number;
      weightedScore: number;
      reports15m: number;
      reports24h: number;
      clusterClassification: "BASELINE" | "CONCENTRATED" | "COORDINATED_SUSPECTED";
      shadowOnly: true;
    };
    target: { hidden: boolean };
  };
};

export interface ContentReportService {
  report(command: ContentReportCommand): Promise<ContentReportResult>;
}

export type CommentSide = "ALL" | "A" | "B";
export type CommentReportReason =
  "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";
export type CommentModerationAction = "COLLAPSE" | "HIDE" | "REMOVE_POLICY" | "RESTORE";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED";
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  reactions: { helpfulCount: number; viewerReacted: boolean };
  reports: { viewerReported: boolean; canReport: boolean };
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
};

export type GuestCommentQuery = {
  issueId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  side: CommentSide;
  cursor?: string;
  limit: number;
};

export type MemberCommentSubmission = {
  issueId: string;
  sessionToken: string;
  idempotencyKey: string;
  body: string;
};

export type MemberCommentSubmissionResult = {
  httpStatus: 201;
  body: { comment: PublicComment };
};

export type HelpfulReactionCommand = {
  commentId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  idempotencyKey: string;
};

export type HelpfulReactionResult = {
  httpStatus: 200;
  body: {
    reaction: { code: "HELPFUL"; active: boolean; helpfulCount: number };
  };
};

export type CommentReportCommand = {
  commentId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  idempotencyKey: string;
  reason: CommentReportReason;
  detail?: string;
};

export type CommentReportResult = {
  httpStatus: 201;
  body: {
    report: { accepted: true; viewerReported: true };
    comment: { visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "HIDDEN" };
  };
};

export type CommentModerationCase = {
  commentId: string;
  issueId: string;
  authorDisplayName: string;
  body: string;
  publicationState: string;
  visibility: string;
  integrityState: string;
  reportScore: number;
  reporterCount: number;
  effectiveReportScore: number;
  effectiveReporterCount: number;
  updatedAt: string;
};

export type CommentModerationDecisionCommand = {
  commentId: string;
  action: CommentModerationAction;
  reasonCode: string;
};

export interface CommentService {
  listGuestComments(query: GuestCommentQuery): Promise<PublicCommentPage>;
  submitMemberComment(command: MemberCommentSubmission): Promise<MemberCommentSubmissionResult>;
  toggleHelpfulReaction(command: HelpfulReactionCommand): Promise<HelpfulReactionResult>;
  reportComment(command: CommentReportCommand): Promise<CommentReportResult>;
  listModerationCases(limit: number): Promise<{ items: CommentModerationCase[] }>;
  decideModeration(command: CommentModerationDecisionCommand): Promise<{
    comment: { id: string; publicationState: string; visibility: string; integrityState: string };
  }>;
}

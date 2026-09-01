export type CommentSide = "ALL" | "A" | "B" | "C" | "D";
export type CommentListView = "NEWEST" | "HIGHLIGHT";
export type CommentListSort = "NEWEST" | "HELPFUL";
export type CommentReportReason =
  "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";
export type CommentModerationAction = "COLLAPSE" | "HIDE" | "REMOVE_POLICY" | "RESTORE";
export type CommentReactionCode = "HELPFUL" | "DISLIKE";

export type PublicComment = {
  id: string;
  choice: "A" | "B" | "C" | "D";
  author: { displayName: string; avatarUrl: string | null };
  body: string;
  visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED";
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  parentCommentId: string | null;
  reactions: {
    helpfulCount: number;
    dislikeCount: number;
    viewerReaction: CommentReactionCode | null;
  };
  reports: { viewerReported: boolean; canReport: boolean };
  permissions: { canEdit: boolean; canDelete: boolean };
  replies: PublicComment[];
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
  totalCount: number;
};

export type CommentHighlights = {
  A: PublicComment[];
  B: PublicComment[];
  C: PublicComment[];
  D: PublicComment[];
};

export type GuestCommentQuery = {
  issueId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  side: CommentSide;
  sort?: CommentListSort;
  view?: CommentListView;
  cursor?: string;
  limit: number;
};

export type MemberCommentSubmission = {
  issueId: string;
  sessionToken: string;
  anonymousSubjectId?: string;
  idempotencyKey: string;
  body: string;
  parentCommentId?: string;
};

export type MemberCommentSubmissionResult = {
  httpStatus: 201;
  body: { comment: PublicComment };
};

export type MemberCommentUpdateCommand = {
  commentId: string;
  sessionToken: string;
  body: string;
};

export type MemberCommentUpdateResult = {
  httpStatus: 200;
  body: { comment: { id: string; body: string; editedAt: string } };
};

export type MemberCommentDeleteCommand = {
  commentId: string;
  sessionToken: string;
};

export type MemberCommentDeleteResult = {
  httpStatus: 200;
  body: { comment: { id: string; deleted: true } };
};

export type CommentReactionCommand = {
  commentId: string;
  sessionToken?: string;
  anonymousSubjectId?: string;
  idempotencyKey: string;
  code: CommentReactionCode;
};

export type CommentReactionResult = {
  httpStatus: 200;
  body: {
    reaction: {
      code: CommentReactionCode;
      active: boolean;
      helpfulCount: number;
      dislikeCount: number;
    };
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
  updateMemberComment(command: MemberCommentUpdateCommand): Promise<MemberCommentUpdateResult>;
  deleteMemberComment(command: MemberCommentDeleteCommand): Promise<MemberCommentDeleteResult>;
  toggleCommentReaction(command: CommentReactionCommand): Promise<CommentReactionResult>;
  reportComment(command: CommentReportCommand): Promise<CommentReportResult>;
  listModerationCases(limit: number): Promise<{ items: CommentModerationCase[] }>;
  decideModeration(command: CommentModerationDecisionCommand): Promise<{
    decisionId: string;
    comment: { id: string; publicationState: string; visibility: string; integrityState: string };
  }>;
}

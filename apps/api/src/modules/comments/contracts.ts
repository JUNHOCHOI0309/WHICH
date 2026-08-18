export type CommentSide = "ALL" | "A" | "B";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  reactions: { helpfulCount: number; viewerReacted: boolean };
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

export interface CommentService {
  listGuestComments(query: GuestCommentQuery): Promise<PublicCommentPage>;
  submitMemberComment(command: MemberCommentSubmission): Promise<MemberCommentSubmissionResult>;
  toggleHelpfulReaction(command: HelpfulReactionCommand): Promise<HelpfulReactionResult>;
}

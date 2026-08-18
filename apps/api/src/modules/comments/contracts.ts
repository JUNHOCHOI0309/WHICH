export type CommentSide = "ALL" | "A" | "B";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
};

export type GuestCommentQuery = {
  issueId: string;
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

export interface CommentService {
  listGuestComments(query: GuestCommentQuery): Promise<PublicCommentPage>;
  submitMemberComment(command: MemberCommentSubmission): Promise<MemberCommentSubmissionResult>;
}

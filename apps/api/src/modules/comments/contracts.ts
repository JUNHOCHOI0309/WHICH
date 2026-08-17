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

export interface CommentReadService {
  listGuestComments(query: GuestCommentQuery): Promise<PublicCommentPage>;
}

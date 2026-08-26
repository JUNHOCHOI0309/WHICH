import type { FeedItemRecommendation, FeedRankingContext } from "../recommendations/contracts.js";
import type { InterestCardCode } from "../interests/contracts.js";

export type PublicIssueChoice = {
  id: string;
  code: "A" | "B";
  label: string;
  media: {
    url: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    width: number;
    height: number;
  } | null;
};

export type PublicIssueTally = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState:
    "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
};

export type PublicIssue = {
  id: string;
  version: number;
  question: string;
  context: string | null;
  publishedAt: string;
  categoryCode: string;
  experienceModeCode: string;
  mediaMode: "TEXT_ONLY" | "OPTION_IMAGES";
  choices: PublicIssueChoice[];
  author: {
    displayName: string;
    handle: string;
    avatar: { kind: "INITIALS"; initials: string } | { kind: "IMAGE"; url: string };
  } | null;
  result: {
    visibility:
      | "PRE_VOTE_HIDDEN"
      | "RESULT_VISIBLE"
      | "RESULT_LOCKED"
      | "RESULT_DEGRADED"
      | "RESULT_UNAVAILABLE";
    tally: PublicIssueTally | null;
  };
};

export type PublicFeedIssue = Omit<
  PublicIssue,
  "context" | "experienceModeCode" | "result" | "author"
> & {
  recommendation: FeedItemRecommendation & { requestId: string };
};

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
  ranking: FeedRankingContext;
};

export type GuestIssueFeedQuery = {
  cursor?: string;
  limit: number;
  excludeIssueId?: string;
  anonymousSubjectId?: string;
  sessionToken?: string;
};

export interface IssueReadService {
  getGuestIssue(
    issueId: string,
    viewer?: { anonymousSubjectId?: string; sessionToken?: string },
  ): Promise<PublicIssue>;
  listGuestIssues(query: GuestIssueFeedQuery): Promise<PublicIssueFeed>;
}

export type CreateMemberIssueCommand = {
  sessionToken: string;
  idempotencyKey: string;
  question: string;
  context?: string | null;
  choiceA: string;
  choiceB: string;
  interestCardCode: InterestCardCode;
};

export type CreatedMemberIssue = {
  issue: {
    id: string;
    version: 1;
    question: string;
    context: string | null;
    choices: [{ code: "A"; label: string }, { code: "B"; label: string }];
    interestCardCode: InterestCardCode;
    publishedAt: string;
  };
  created: boolean;
};

export interface IssueWriteService {
  createMemberIssue(command: CreateMemberIssueCommand): Promise<CreatedMemberIssue>;
}

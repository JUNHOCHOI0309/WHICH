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
  rightRail: {
    version: "participation_v1";
    items: Array<{
      issueId: string;
      question: string;
      categoryCode: string;
      participationCount: number;
      reasonCode: "RECENT_PARTICIPATION" | "RECENT_FALLBACK";
    }>;
  };
};

export type PublicIssueCatalogItem = Pick<
  PublicIssue,
  "id" | "version" | "question" | "context" | "publishedAt" | "categoryCode" | "choices"
>;

export type PublicIssueCatalog = {
  items: PublicIssueCatalogItem[];
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
  listPublicIssueCatalog(query: { limit: number }): Promise<PublicIssueCatalog>;
}

export type CreateMemberIssueCommand = {
  sessionToken: string;
  idempotencyKey: string;
  question: string;
  context?: string | null;
  choiceA: string;
  choiceB: string;
  mediaAssetAId?: string | null;
  mediaAssetBId?: string | null;
  libraryPairId?: string | null;
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
  actOnMemberIssueSubmission(command: {
    sessionToken: string;
    submissionId: string;
    expectedRevision: number;
    action: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "CHECK";
    libraryPairId?: string;
  }): Promise<MemberIssueSubmissionResult>;
  createMemberIssue(command: CreateMemberIssueCommand): Promise<CreatedMemberIssue>;
  submitMemberIssue(command: CreateMemberIssueCommand): Promise<MemberIssueSubmissionResult>;
  resubmitMemberIssue(command: ResubmitMemberIssueCommand): Promise<MemberIssueSubmissionResult>;
  listMemberIssueSubmissions(command: {
    sessionToken: string;
    limit: number;
    submissionId?: string;
  }): Promise<{ items: MemberIssueSubmission[] }>;
}

export type ResubmitMemberIssueCommand = CreateMemberIssueCommand & {
  submissionId: string;
  expectedRevision: number;
};

export type MemberIssueSubmissionStatus =
  "PENDING" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED" | "CANCELLED";

export type MemberIssueSubmission = {
  id: string;
  revision: number;
  status: MemberIssueSubmissionStatus;
  publishedIssueId: string | null;
  publicationState:
    "PROCESSING" | "PUBLISHED" | "NEEDS_CHANGES" | "REJECTED" | "QUARANTINED" | "CANCELLED";
  question: string;
  context: string | null;
  choiceA: string;
  choiceB: string;
  mediaAssetAId: string | null;
  mediaAssetBId: string | null;
  interestCardCode: InterestCardCode;
  reviewNote: string | null;
  submittedAt: string;
  updatedAt: string;
};

export type MemberIssueSubmissionResult = {
  submission: MemberIssueSubmission;
  created: boolean;
};

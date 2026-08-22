export type IdentityProvider = "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";

export type MemberView = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
};

export type IdentityAssertion = {
  provider: IdentityProvider;
  providerSubject: string;
  displayName: string;
  anonymousSubjectId?: string;
};

export type MemberSessionResult = {
  token: string;
  expiresAt: string;
  member: MemberView;
  guestLink: {
    linked: boolean;
    invalidatedDuplicateVotes: number;
    migratedReactions: number;
    mergedDuplicateReactions: number;
  };
};

export type MemberIdentityLinkResult = {
  token: string;
  expiresAt: string;
  member: MemberView;
  identity: {
    provider: IdentityProvider;
    linked: boolean;
    memberMerged: boolean;
  };
};

export type MemberVoteHistoryQuery = {
  limit: number;
  cursor?: {
    acceptedAt: Date;
    voteId: string;
  };
};

export type MemberVoteHistoryItem = {
  voteId: string;
  issueId: string;
  issueVersion: number;
  question: string;
  categoryCode: string;
  choice: "A" | "B";
  choiceLabel: string;
  acceptedAt: string;
  result: {
    resultVersion: number;
    acceptedA: number;
    acceptedB: number;
    displayedTotal: number;
    integrityState:
      "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
  };
};

export type MemberPrivateProfile = {
  member: MemberView & {
    joinedAt: string;
    participationCount: number;
  };
  publicProfile: MemberProfileSettings | null;
  identities: Array<{
    provider: IdentityProvider;
    linkedAt: string;
    lastAuthenticatedAt: string;
  }>;
  votes: {
    items: MemberVoteHistoryItem[];
    nextCursor: string | null;
  };
};

export type MemberProfileSettings = {
  handle: string;
  bio: string | null;
  visibility: "PRIVATE" | "PUBLIC";
  publicUrl: string | null;
};

export type MemberProfileUpdate = {
  handle: string;
  bio: string | null;
  visibility: "PRIVATE" | "PUBLIC";
};

export type PublicCreatorIssue = {
  id: string;
  version: number;
  question: string;
  categoryCode: string;
  publishedAt: string;
  acceptedVoteCount: number;
};

export type PublicCreatorProfile = {
  creator: {
    displayName: string;
    handle: string;
    bio: string | null;
    joinedMonth: string;
    avatar: { kind: "INITIALS"; initials: string };
  };
  stats: {
    publishedIssueCount: number;
    acceptedVoteCount: number;
  };
  issues: PublicCreatorIssue[];
};

export type MemberVoteLookupResult = {
  outcome: "ACCEPTED";
  voteAttemptId: string;
  voteId: string;
  issueId: string;
  issueVersion: number;
  choice: "A" | "B";
  result: MemberVoteHistoryItem["result"];
};

export interface MemberIdentityService {
  createSession(assertion: IdentityAssertion): Promise<MemberSessionResult>;
  linkIdentity(
    memberId: string,
    assertion: Omit<IdentityAssertion, "anonymousSubjectId">,
  ): Promise<MemberIdentityLinkResult>;
  getSession(token: string): Promise<{ expiresAt: string; member: MemberView } | null>;
  getPrivateProfile(
    token: string,
    query: MemberVoteHistoryQuery,
  ): Promise<MemberPrivateProfile | null>;
  updateProfile(token: string, command: MemberProfileUpdate): Promise<MemberProfileSettings | null>;
  getPublicCreatorProfile(handle: string): Promise<PublicCreatorProfile | null>;
  findPrivateVote(
    token: string,
    issueId: string,
  ): Promise<{
    member: MemberView;
    vote: MemberVoteLookupResult | null;
  } | null>;
  revokeSession(token: string): Promise<boolean>;
}

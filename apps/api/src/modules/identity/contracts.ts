export type IdentityProvider = "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";

export type MemberAvatar = { kind: "INITIALS"; initials: string } | { kind: "IMAGE"; url: string };

export type MemberView = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  avatar: MemberAvatar;
};

export type IdentityAssertion = {
  provider: IdentityProvider;
  providerSubject: string;
  displayName: string;
  avatarUrl?: string;
  anonymousSubjectId?: string;
  createIfMissing?: boolean;
  credential?: {
    email: string;
    password: string;
  };
  authRequestKey?: string;
};

export type CredentialSessionAssertion = {
  email: string;
  password: string;
  anonymousSubjectId?: string;
  authRequestKey?: string;
};

export type AuthEmailDelivery = {
  email: string;
  token: string;
  expiresAt: string;
};

export type MemberCredentialResult = {
  member: MemberView;
  email: string;
};

export type MemberAccountDeletionResult = {
  deleted: true;
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
    avatar: MemberAvatar;
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
  createCredentialSession(assertion: CredentialSessionAssertion): Promise<MemberSessionResult>;
  addCredential(
    memberId: string,
    credential: { email: string; password: string },
  ): Promise<MemberCredentialResult>;
  requestEmailVerification(input: {
    email: string;
    authRequestKey?: string;
  }): Promise<AuthEmailDelivery | null>;
  verifyEmail(input: { token: string; authRequestKey?: string }): Promise<{ verified: true }>;
  requestPasswordReset(input: {
    email: string;
    authRequestKey?: string;
  }): Promise<AuthEmailDelivery | null>;
  resetPassword(input: {
    token: string;
    password: string;
    authRequestKey?: string;
  }): Promise<{ reset: true }>;
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
  deleteAccount(token: string, password: string): Promise<MemberAccountDeletionResult | null>;
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

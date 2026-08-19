export type IdentityProvider = "GOOGLE" | "X" | "DEVELOPMENT";

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

export interface MemberIdentityService {
  createSession(assertion: IdentityAssertion): Promise<MemberSessionResult>;
  getSession(token: string): Promise<{ expiresAt: string; member: MemberView } | null>;
  revokeSession(token: string): Promise<boolean>;
}

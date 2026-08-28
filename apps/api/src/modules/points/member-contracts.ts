export type MemberPointLedgerEntryType = "EARN" | "SPEND" | "REFUND" | "REVERSAL" | "ADJUSTMENT";

export type MemberPointBadgeCode = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export type MemberPointBadge = {
  code: MemberPointBadgeCode;
  label: string;
  minimumLifetimePoints: number;
  assetKey: string;
  awardedAt?: string;
};

export type MemberPointLedgerItem = {
  id: string;
  entryType: MemberPointLedgerEntryType;
  amount: number;
  reasonCode: string;
  reasonLabel: string;
  createdAt: string;
};

export type MemberPointView = {
  account: {
    balance: number;
    todayEarned: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    hasPendingRecovery: boolean;
  };
  badge: {
    policyVersion: string;
    current: MemberPointBadge | null;
    next: MemberPointBadge | null;
    progress: number;
  };
  ledger: {
    items: MemberPointLedgerItem[];
    nextCursor: string | null;
  };
};

export type MemberPointLedgerQuery = {
  limit: number;
  cursor?: {
    createdAt: Date;
    entryId: string;
  };
};

export interface MemberPointService {
  getMemberPoints(memberId: string, query: MemberPointLedgerQuery): Promise<MemberPointView>;
}

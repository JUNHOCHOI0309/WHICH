export type MemberPointLedgerEntryType = "EARN" | "SPEND" | "REFUND" | "REVERSAL" | "ADJUSTMENT";

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

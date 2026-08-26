import type { VoteResult } from "../voting/contracts.js";

export const SHARE_VERSION = "result_share_v1" as const;
export const SHARE_CHANNELS = ["COPY", "SYSTEM", "X"] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export type CreateShareCardCommand = {
  issueId: string;
  issueVersion: number;
  resultVersion: number;
  channel: ShareChannel;
  sharedChoiceCode?: "A" | "B";
};

export type PublicShareCard = {
  id: string;
  version: typeof SHARE_VERSION;
  channel: ShareChannel;
  shareType: "RESULT" | "RESULT_WITH_CHOICE";
  sharedChoiceCode: "A" | "B" | null;
  createdAt: string;
  issue: {
    id: string;
    version: number;
    question: string;
    choices: Array<{ code: "A" | "B"; label: string }>;
  };
  result: VoteResult;
};

export interface ShareCardService {
  createShareCard(command: CreateShareCardCommand): Promise<PublicShareCard>;
  getShareCard(shareCardId: string): Promise<PublicShareCard>;
  confirmRewardClaim(command: {
    shareCardId: string;
    sessionToken: string;
    idempotencyKey: string;
  }): Promise<{ claimed: boolean }>;
}

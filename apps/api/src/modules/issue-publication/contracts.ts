import type { IssuePublicationTarget } from "./manifest.js";

export type IssuePublicationAction = "CREATE" | "NOOP" | "CONFLICT";

export type IssuePublicationPlanItem = {
  issueId: string;
  issueVersion: number;
  action: IssuePublicationAction;
  reasons: string[];
};

export type IssuePublicationPlan = {
  schemaVersion: 1;
  packId: string;
  manifestDigest: string;
  target: IssuePublicationTarget;
  summary: {
    create: number;
    noOp: number;
    conflict: number;
  };
  issues: IssuePublicationPlanItem[];
};

export type IssuePublicationResult = {
  schemaVersion: 1;
  packId: string;
  manifestDigest: string;
  target: IssuePublicationTarget;
  created: number;
  alreadyPresent: number;
  verification: IssuePublicationPlan;
};

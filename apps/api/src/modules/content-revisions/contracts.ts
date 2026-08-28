export type ModerationRecheckTargetType =
  "COMMENT_REVISION" | "ISSUE_VERSION" | "MEDIA_ASSET_VERSION";

export type ModerationRecheckReason =
  "CREATE" | "EDIT" | "REPLACEMENT" | "POLICY_CHANGE" | "APPEAL" | "RIGHTS" | "BACKFILL";

export type ModerationRecheckRequest = {
  id: string;
  targetType: ModerationRecheckTargetType;
  targetId: string;
  targetVersion: number;
  policyVersion: string;
  inputHash: string;
  normalizedSnapshotRef: string;
  ocrTranscriptRef: string | null;
  reason: ModerationRecheckReason;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  requestedAt: string;
};

export type CreateModerationRecheckCommand = Omit<
  ModerationRecheckRequest,
  "id" | "status" | "requestedAt" | "ocrTranscriptRef"
> & {
  ocrTranscriptRef?: string;
};

export interface ContentRevisionService {
  requestModerationRecheck(
    command: CreateModerationRecheckCommand,
  ): Promise<{ created: boolean; request: ModerationRecheckRequest }>;
}

import { createHash } from "node:crypto";

export const ISSUE_MEDIA_EXPERIMENT_ID = "which-86-option-images-v1" as const;

export type IssueMediaExperimentOptions = {
  enabled: boolean;
  exposurePercent: number;
  publicUrl?: (objectKey: string) => string;
};

export function issueMediaTreatmentEnabled(
  options: IssueMediaExperimentOptions | undefined,
  viewerKey: string | undefined,
  issueId: string,
) {
  if (!options?.enabled || !options.publicUrl || !viewerKey || options.exposurePercent <= 0) {
    return false;
  }
  if (options.exposurePercent >= 100) return true;

  const digest = createHash("sha256")
    .update(`${ISSUE_MEDIA_EXPERIMENT_ID}:${viewerKey}:${issueId}`)
    .digest();
  const bucket = digest.readUInt32BE(0) % 10_000;
  return bucket < options.exposurePercent * 100;
}

export function issueMediaViewerKey(viewer: {
  anonymousSubjectId?: string;
  sessionToken?: string;
}) {
  if (viewer.sessionToken) return `member:${viewer.sessionToken}`;
  if (viewer.anonymousSubjectId) return `guest:${viewer.anonymousSubjectId}`;
  return undefined;
}

import { sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";

export const MEMBER_ISSUE_ACCESS_POLICY_VERSION = "which-member-issue-access-v1";

const DAY_MS = 24 * 60 * 60 * 1_000;
const SOFT_WINDOW_MS = 7 * DAY_MS;
const HARD_WINDOW_MS = 14 * DAY_MS;
const HARD_COOLDOWN_MS = 72 * 60 * 60 * 1_000;

export type EffectiveContentReport = {
  subjectId: string;
  targetKey: string;
  createdAt: Date;
};

export type MemberIssueAccess = {
  policyVersion: typeof MEMBER_ISSUE_ACCESS_POLICY_VERSION;
  state: "OPEN" | "LIMITED" | "BLOCKED";
  canCreateNow: boolean;
  canStartUpload: boolean;
  reasonCode: null | "REPORT_RATE_LIMIT" | "REPORT_COOLDOWN";
  restrictedUntil: string | null;
};

function uniqueCounts(rows: EffectiveContentReport[]) {
  return {
    reporters: new Set(rows.map((row) => row.subjectId)).size,
    targets: new Set(rows.map((row) => row.targetKey)).size,
  };
}

export function evaluateMemberIssueAccess(input: {
  reports: EffectiveContentReport[];
  recentSubmissionTimes: Date[];
  now: Date;
}): MemberIssueAccess {
  const hardReports = input.reports.filter(
    (report) => input.now.getTime() - report.createdAt.getTime() <= HARD_WINDOW_MS,
  );
  const hardCounts = uniqueCounts(hardReports);
  const latestHardReport = hardReports.reduce<Date | null>(
    (latest, report) => (!latest || report.createdAt > latest ? report.createdAt : latest),
    null,
  );
  const hardUntil = latestHardReport
    ? new Date(latestHardReport.getTime() + HARD_COOLDOWN_MS)
    : null;
  if (hardCounts.reporters >= 5 && hardCounts.targets >= 3 && hardUntil && hardUntil > input.now) {
    return {
      policyVersion: MEMBER_ISSUE_ACCESS_POLICY_VERSION,
      state: "BLOCKED",
      canCreateNow: false,
      canStartUpload: false,
      reasonCode: "REPORT_COOLDOWN",
      restrictedUntil: hardUntil.toISOString(),
    };
  }

  const softReports = input.reports.filter(
    (report) => input.now.getTime() - report.createdAt.getTime() <= SOFT_WINDOW_MS,
  );
  const softCounts = uniqueCounts(softReports);
  if (softCounts.reporters >= 3 && softCounts.targets >= 2) {
    const latestSubmission = input.recentSubmissionTimes
      .filter((submittedAt) => input.now.getTime() - submittedAt.getTime() <= DAY_MS)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const restrictedUntil = latestSubmission ? new Date(latestSubmission.getTime() + DAY_MS) : null;
    return {
      policyVersion: MEMBER_ISSUE_ACCESS_POLICY_VERSION,
      state: "LIMITED",
      canCreateNow: !restrictedUntil || restrictedUntil <= input.now,
      // A limited Member may finish adding media to the one allowed submission.
      canStartUpload: true,
      reasonCode: restrictedUntil && restrictedUntil > input.now ? "REPORT_RATE_LIMIT" : null,
      restrictedUntil:
        restrictedUntil && restrictedUntil > input.now ? restrictedUntil.toISOString() : null,
    };
  }

  return {
    policyVersion: MEMBER_ISSUE_ACCESS_POLICY_VERSION,
    state: "OPEN",
    canCreateNow: true,
    canStartUpload: true,
    reasonCode: null,
    restrictedUntil: null,
  };
}

type QueryDatabase = Pick<Database["db"], "execute">;

export async function readMemberIssueAccess(
  database: QueryDatabase,
  memberId: string,
  now = new Date(),
): Promise<MemberIssueAccess> {
  const reportRows = await database.execute<{
    subject_id: string;
    target_key: string;
    created_at: Date;
  }>(sql`
    select cr.subject_id,
      cr.target_type || ':' || cr.target_id::text as target_key,
      cr.created_at
    from content_reports cr
    join report_cases rc on rc.report_case_id = cr.report_case_id
    join report_clusters cluster on cluster.report_cluster_id = cr.report_cluster_id
    where cr.counted = true
      and cr.created_at >= ${new Date(now.getTime() - HARD_WINDOW_MS)}
      and rc.status <> 'DISMISSED'
      and cluster.classification <> 'COORDINATED_SUSPECTED'
      and (
        (cr.target_type = 'ISSUE' and exists (
          select 1 from issue_authors author
          where author.issue_id = cr.target_id and author.member_id = ${memberId}
        ))
        or
        (cr.target_type = 'ISSUE_MEDIA' and exists (
          select 1 from issue_media_assets asset
          where asset.media_asset_id = cr.target_id
            and asset.uploaded_by_member_id = ${memberId}
        ))
      )
  `);

  const recentSubmissions = await database.execute<{ submitted_at: Date }>(sql`
    select submitted_at
    from member_issue_submissions
    where member_id = ${memberId}
      and submitted_at >= ${new Date(now.getTime() - DAY_MS)}
  `);

  return evaluateMemberIssueAccess({
    reports: reportRows.rows.map((row) => ({
      subjectId: row.subject_id,
      targetKey: row.target_key,
      createdAt: new Date(row.created_at),
    })),
    recentSubmissionTimes: recentSubmissions.rows.map((row) => new Date(row.submitted_at)),
    now,
  });
}

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import {
  issues,
  issueChoiceMedia,
  issueChoices,
  issueInterestCards,
  issueMediaAssets,
  issueVersions,
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  operatorEditorialDecisions,
  pointCatalogItems,
  pointCatalogItemVersions,
  pointPurchases,
  reportCases,
  resultSnapshots,
  voteAggregates,
  outboxEvents,
} from "../../database/schema/index.js";
import { defaultReviewConsolePaths } from "../../editorial-review-console.js";
import { loadIssueInventoryReadiness } from "../issue-publication/inventory.js";
import { EditorialReviewConsole } from "../issue-publication/review-console.js";
import { evaluateMemberIssueAccessSignals } from "../issues/member-issue-access.js";
import { sealIssueVersionSnapshot } from "../content-revisions/service.js";
import { createModerationSubmissionEvents } from "../moderation-dispatch/contracts.js";

import {
  OpsPublishedIssueConflictError,
  OpsReviewConflictError,
  OpsPointShopConflictError,
  type OpsDashboardService,
  type OpsDashboardSnapshot,
  type OpsDashboardWindow,
  type OpsEditorialDecision,
  type OpsEditorialPage,
  type OpsMemberPage,
  type OpsPublishedIssue,
  type OpsPublishedIssuePage,
  type OpsReportedMembersPage,
  type OpsPointShopItem,
  type OpsPointShopView,
  type OpsRankingPreview,
} from "./contracts.js";

const inventoryCandidatesSchema = z.object({
  longTermCandidateIds: z.array(z.string()),
});

type Warning = OpsDashboardSnapshot["warnings"][number];

function numberValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function nullableNumber(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function findContentRoot() {
  const directory = [
    resolve(process.cwd(), "content"),
    resolve(process.cwd(), "apps/api/content"),
  ].find((candidate) => existsSync(candidate));
  if (!directory) throw new Error("The API content directory could not be located.");
  return directory;
}

const contentRoot = findContentRoot();

let editorialSnapshotPromise: ReturnType<typeof loadEditorialSnapshot> | undefined;

async function loadEditorialSnapshot() {
  const [readiness, inventory] = await Promise.all([
    loadIssueInventoryReadiness(
      resolve(contentRoot, "issue-packs/public-v0-inventory-policy.json"),
    ),
    readFile(resolve(contentRoot, "editorial/expanded/inventory-candidates-v2.json"), "utf8").then(
      (value) => inventoryCandidatesSchema.parse(JSON.parse(value) as unknown),
    ),
  ]);
  return { readiness, longTermIssues: inventory.longTermCandidateIds.length };
}

function editorialSnapshot() {
  editorialSnapshotPromise ??= loadEditorialSnapshot();
  return editorialSnapshotPromise;
}

let editorialReviewStatePromise: ReturnType<typeof loadEditorialReviewState> | undefined;

async function loadEditorialReviewState() {
  const review = await EditorialReviewConsole.load(defaultReviewConsolePaths());
  return review.getState();
}

function editorialReviewState() {
  editorialReviewStatePromise ??= loadEditorialReviewState();
  return editorialReviewStatePromise;
}

function encodeMemberCursor(createdAt: Date | string, memberId: string) {
  return Buffer.from(
    JSON.stringify({ createdAt: new Date(createdAt).toISOString(), memberId }),
  ).toString("base64url");
}

function decodeMemberCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      memberId?: unknown;
    };
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.memberId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.memberId)
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, memberId: parsed.memberId };
  } catch {
    throw new Error("The Member cursor is invalid.");
  }
}

function mapDecision(row: {
  status: string;
  note: string;
  reviewedBy: string;
  reviewedAt: Date;
  revision: number;
  binaryFit: boolean;
  choiceParity: boolean;
  duplicateReview: boolean;
  sourceReview: boolean;
}): OpsEditorialDecision {
  return {
    status: row.status as OpsEditorialDecision["status"],
    note: row.note,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt.toISOString(),
    revision: row.revision,
    checks: {
      binaryFit: row.binaryFit,
      choiceParity: row.choiceParity,
      duplicateReview: row.duplicateReview,
      sourceReview: row.sourceReview,
    },
  };
}

type OpsManagementMethods = Pick<
  OpsDashboardService,
  | "readMembers"
  | "readReportedMembers"
  | "readEditorial"
  | "saveEditorialDecision"
  | "readPublishedIssues"
  | "updatePublishedIssue"
  | "revisePublishedIssueMedia"
>;

type OpsPointShopMethods = Pick<
  OpsDashboardService,
  "readPointShop" | "createPointShopItem" | "updatePointShopItem"
>;

const pointShopAuditEvents = [
  "OPS_POINT_SHOP_ITEM_CREATED",
  "OPS_POINT_SHOP_ITEM_UPDATED",
] as const;

function mapPointShopItem(row: {
  id: string;
  code: string;
  equipSlot: string;
  themeFamily: string;
  name: string;
  description: string;
  price: number;
  status: string;
  currentVersion: number;
  opsRevision: number;
  purchaseCount: number | string;
  createdAt: Date;
  updatedAt: Date;
}): OpsPointShopItem {
  return {
    ...row,
    equipSlot: row.equipSlot as OpsPointShopItem["equipSlot"],
    themeFamily: row.themeFamily as OpsPointShopItem["themeFamily"],
    status: row.status as OpsPointShopItem["status"],
    purchaseCount: Number(row.purchaseCount),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pointShopItemSelection() {
  return {
    id: pointCatalogItems.id,
    code: pointCatalogItems.code,
    equipSlot: pointCatalogItems.equipSlot,
    themeFamily: pointCatalogItems.themeFamily,
    name: pointCatalogItems.name,
    description: pointCatalogItems.description,
    price: pointCatalogItems.price,
    status: pointCatalogItems.status,
    currentVersion: pointCatalogItems.currentVersion,
    opsRevision: pointCatalogItems.opsRevision,
    purchaseCount: sql<number>`(
      select count(*)::int from ${pointPurchases}
      where ${pointPurchases.itemId} = ${pointCatalogItems.id}
        and ${pointPurchases.status} = 'COMPLETED'
    )`,
    createdAt: pointCatalogItems.createdAt,
    updatedAt: pointCatalogItems.updatedAt,
  };
}

function createOpsManagementMethods(
  database: Database["db"],
  operator: (memberId: string) => Promise<{ memberId: string; displayName: string } | null>,
  audit: (input: {
    memberId: string;
    eventType?: string;
    outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
    windowDays?: OpsDashboardWindow;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>,
): OpsManagementMethods {
  type PublishedIssueRow = {
    issue_id: string;
    version: number;
    question: string;
    context: string | null;
    choices: unknown;
    category_code: string;
    media_mode: string;
    author_member_id: string | null;
    author_display_name: string | null;
    lifecycle: string;
    visibility: string;
    participation: string;
    feed_eligibility: string;
    accepted_votes: number;
    report_count: number;
    active_report_review: unknown;
    published_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  };

  function publishedIssueState(row: PublishedIssueRow): OpsPublishedIssue["state"] {
    if (row.lifecycle === "RETIRED" || row.visibility === "REMOVED") return "REMOVED";
    if (["CLOSED", "ARCHIVED"].includes(row.lifecycle)) return "CLOSED";
    if (
      row.visibility !== "VISIBLE" ||
      row.participation !== "VOTING_OPEN" ||
      row.feed_eligibility === "EXCLUDED"
    )
      return "HIDDEN";
    return "ACTIVE";
  }

  function mapPublishedIssue(row: PublishedIssueRow): OpsPublishedIssue {
    const choices = Array.isArray(row.choices)
      ? row.choices.flatMap((choice) => {
          if (typeof choice !== "object" || choice === null) return [];
          const value = choice as Record<string, unknown>;
          if (
            typeof value.id !== "string" ||
            !["A", "B", "C", "D"].includes(String(value.code)) ||
            typeof value.label !== "string"
          )
            return [];
          const media =
            typeof value.assetId === "string" &&
            typeof value.altText === "string" &&
            ["COVER", "CONTAIN"].includes(String(value.cropMode))
              ? {
                  assetId: value.assetId,
                  altText: value.altText,
                  cropMode: String(value.cropMode) as "COVER" | "CONTAIN",
                }
              : null;
          return [
            {
              id: value.id,
              code: String(value.code) as "A" | "B" | "C" | "D",
              label: value.label,
              media,
            },
          ];
        })
      : [];
    const activeReportValue =
      typeof row.active_report_review === "object" && row.active_report_review !== null
        ? (row.active_report_review as Record<string, unknown>)
        : null;
    const activeReportReview =
      activeReportValue &&
      typeof activeReportValue.caseId === "string" &&
      ["OPEN", "QUARANTINED", "PENDING_REVIEW"].includes(String(activeReportValue.status)) &&
      ["NORMAL", "P0"].includes(String(activeReportValue.priority)) &&
      ["NONE", "P0_REVIEW", "QUARANTINE_REVIEW"].includes(
        String(activeReportValue.automationRecommendation),
      ) &&
      typeof activeReportValue.policyVersion === "string" &&
      typeof activeReportValue.createdAt === "string" &&
      typeof activeReportValue.updatedAt === "string"
        ? {
            caseId: activeReportValue.caseId,
            status: String(activeReportValue.status) as "OPEN" | "QUARANTINED" | "PENDING_REVIEW",
            priority: String(activeReportValue.priority) as "NORMAL" | "P0",
            automationRecommendation: String(activeReportValue.automationRecommendation) as
              "NONE" | "P0_REVIEW" | "QUARANTINE_REVIEW",
            policyVersion: activeReportValue.policyVersion,
            reportCount: numberValue(activeReportValue.reportCount as number | string | null),
            reports: Array.isArray(activeReportValue.reports)
              ? activeReportValue.reports.flatMap((report) => {
                  if (typeof report !== "object" || report === null) return [];
                  const value = report as Record<string, unknown>;
                  if (
                    typeof value.id !== "string" ||
                    typeof value.reasonCode !== "string" ||
                    !["GUEST", "MEMBER", "VERIFIED_MEMBER"].includes(String(value.reporterKind)) ||
                    typeof value.createdAt !== "string"
                  )
                    return [];
                  return [
                    {
                      id: value.id,
                      reasonCode: value.reasonCode,
                      detail: typeof value.detail === "string" ? value.detail : null,
                      reporterKind: String(value.reporterKind) as
                        "GUEST" | "MEMBER" | "VERIFIED_MEMBER",
                      weight: numberValue(value.weight as number | string | null),
                      createdAt: value.createdAt,
                    },
                  ];
                })
              : [],
            createdAt: activeReportValue.createdAt,
            updatedAt: activeReportValue.updatedAt,
          }
        : null;
    return {
      issueId: row.issue_id,
      version: Number(row.version),
      question: row.question,
      context: row.context,
      choices,
      categoryCode: row.category_code,
      mediaMode: row.media_mode,
      author:
        row.author_member_id && row.author_display_name
          ? { memberId: row.author_member_id, displayName: row.author_display_name }
          : null,
      lifecycle: row.lifecycle,
      visibility: row.visibility,
      participation: row.participation,
      feedEligibility: row.feed_eligibility,
      state: publishedIssueState(row),
      acceptedVotes: numberValue(row.accepted_votes),
      reportCount: numberValue(row.report_count),
      activeReportReview,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async function publishedIssueRows(input: {
    state?: OpsPublishedIssue["state"];
    reportedOnly?: boolean;
    query?: string;
    issueId?: string;
    limit: number;
  }) {
    const query = input.query?.trim();
    const queryClause = query
      ? sql`and (
          i.issue_id::text ilike ${`${query}%`}
          or latest.question ilike ${`%${query}%`}
          or coalesce(author.display_name, '') ilike ${`%${query}%`}
        )`
      : sql``;
    const issueClause = input.issueId ? sql`and i.issue_id = ${input.issueId}::uuid` : sql``;
    const reportedClause = input.reportedOnly
      ? sql`and exists (
          select 1 from report_cases active_case
          where active_case.target_type = 'ISSUE' and active_case.target_id = i.issue_id
            and active_case.status in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW')
        )`
      : sql``;
    const stateClause =
      input.state === "ACTIVE"
        ? sql`and i.lifecycle = 'PUBLISHED' and i.visibility = 'VISIBLE'
            and i.participation = 'VOTING_OPEN' and i.feed_eligibility <> 'EXCLUDED'`
        : input.state === "HIDDEN"
          ? sql`and i.lifecycle = 'PUBLISHED' and (
              i.visibility <> 'VISIBLE' or i.participation <> 'VOTING_OPEN'
              or i.feed_eligibility = 'EXCLUDED'
            )`
          : input.state === "CLOSED"
            ? sql`and i.lifecycle in ('CLOSED', 'ARCHIVED')`
            : input.state === "REMOVED"
              ? sql`and (i.lifecycle = 'RETIRED' or i.visibility = 'REMOVED')`
              : sql``;
    const result = await database.execute<PublishedIssueRow>(sql`
      select i.issue_id, latest.version, latest.question, latest.context,
        latest.primary_category_code as category_code, latest.media_mode,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', choice.choice_id,
            'code', choice.choice_code,
            'label', choice.label,
            'assetId', media.media_asset_id,
            'altText', media.alt_text,
            'cropMode', media.crop_mode
          )
            order by choice.choice_code)
          from issue_choices choice
          left join issue_choice_media media
            on media.issue_id = choice.issue_id
            and media.issue_version = choice.issue_version
            and media.choice_id = choice.choice_id
          where choice.issue_id = latest.issue_id and choice.issue_version = latest.version
        ), '[]'::jsonb) as choices,
        ia.member_id as author_member_id, author.display_name as author_display_name,
        i.lifecycle::text as lifecycle, i.visibility::text as visibility,
        i.participation::text as participation, i.feed_eligibility::text as feed_eligibility,
        (select count(*)::int from votes vote where vote.issue_id = i.issue_id
          and vote.issue_version = latest.version and vote.integrity_state = 'ACCEPTED'
          and vote.is_test_subject = false) as accepted_votes,
        (select count(*)::int from content_reports report
          join report_cases report_case on report_case.report_case_id = report.report_case_id
          where report.target_type = 'ISSUE' and report.target_id = i.issue_id
            and report.counted = true and report_case.status <> 'DISMISSED') as report_count,
        (select jsonb_build_object(
          'caseId', active_case.report_case_id,
          'status', active_case.status,
          'priority', active_case.priority,
          'automationRecommendation', active_case.automation_recommendation,
          'policyVersion', active_case.policy_version,
          'reportCount', (select count(*)::int from content_reports active_report
            where active_report.report_case_id = active_case.report_case_id
              and active_report.counted = true),
          'reports', coalesce((select jsonb_agg(jsonb_build_object(
            'id', active_report.content_report_id,
            'reasonCode', active_report.reason_code,
            'detail', active_report.detail,
            'reporterKind', active_report.reporter_kind,
            'weight', active_report.weight_snapshot,
            'createdAt', active_report.created_at
          ) order by active_report.created_at desc)
            from content_reports active_report
            where active_report.report_case_id = active_case.report_case_id
              and active_report.counted = true), '[]'::jsonb),
          'createdAt', active_case.created_at,
          'updatedAt', active_case.updated_at
        ) from report_cases active_case
          where active_case.target_type = 'ISSUE' and active_case.target_id = i.issue_id
            and active_case.status in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW')
          order by active_case.updated_at desc limit 1) as active_report_review,
        latest.published_at, i.created_at, i.updated_at
      from issues i
      join lateral (
        select version.issue_id, version.issue_version as version, version.question, version.context,
          version.primary_category_code, version.media_mode, version.published_at
        from issue_versions version
        where version.issue_id = i.issue_id
          and version.published_at is not null
          and version.published_at <= now()
        order by version.issue_version desc
        limit 1
      ) latest on true
      left join issue_authors ia on ia.issue_id = i.issue_id
      left join members author on author.member_id = ia.member_id
      where true ${queryClause} ${issueClause} ${stateClause} ${reportedClause}
      order by
        case when ${input.reportedOnly ?? false} then (
          select count(*) from content_reports priority_report
          join report_cases priority_case
            on priority_case.report_case_id = priority_report.report_case_id
          where priority_report.target_type = 'ISSUE' and priority_report.target_id = i.issue_id
            and priority_report.counted = true
            and priority_case.status in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW')
        ) else 0 end desc,
        i.updated_at desc, i.issue_id desc
      limit ${Math.max(1, Math.min(input.limit, 100))}
    `);
    return result.rows.map(mapPublishedIssue);
  }

  return {
    async readMembers(input): Promise<OpsMemberPage | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_MEMBERS_READ",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }

      try {
        const cursor = decodeMemberCursor(input.cursor);
        const statusClause = input.status ? sql`and m.status = ${input.status}` : sql``;
        const query = input.query?.trim();
        const queryClause = query
          ? sql`and (
              m.display_name ilike ${`%${query}%`}
              or coalesce(mp.handle, '') ilike ${`%${query}%`}
              or m.member_id::text ilike ${`${query}%`}
            )`
          : sql``;
        const cursorClause = cursor
          ? sql`and (m.created_at, m.member_id) < (${cursor.createdAt}::timestamptz, ${cursor.memberId}::uuid)`
          : sql``;
        const result = await database.execute<{
          member_id: string;
          display_name: string;
          status: string;
          handle: string | null;
          profile_visibility: "PRIVATE" | "PUBLIC" | null;
          providers: string[];
          joined_at: Date | string;
          last_active_at: Date | string | null;
          votes: number;
          comments: number;
          issues: number;
        }>(sql`
          select m.member_id, m.display_name, m.status::text as status,
            mp.handle, mp.visibility::text as profile_visibility,
            array(
              select provider from (
                select mil.provider::text as provider
                from member_identity_links mil where mil.member_id = m.member_id
                union
                select 'EMAIL' where exists (
                  select 1 from member_credentials mc where mc.member_id = m.member_id
                )
              ) providers order by provider
            ) as providers,
            m.created_at as joined_at,
            greatest(
              (select max(ms.last_seen_at) from member_sessions ms where ms.member_id = m.member_id),
              (select max(mil.last_authenticated_at) from member_identity_links mil
                where mil.member_id = m.member_id),
              (select max(vs.last_seen_at) from voter_subjects vs where vs.user_id = m.member_id)
            ) as last_active_at,
            (select count(*)::int from votes v join voter_subjects vs on vs.subject_id = v.subject_id
              where vs.user_id = m.member_id and v.integrity_state = 'ACCEPTED') as votes,
            (select count(*)::int from comments c join voter_subjects vs
              on vs.subject_id = c.author_subject_id where vs.user_id = m.member_id) as comments,
            (select count(*)::int from issue_authors ia where ia.member_id = m.member_id) as issues
          from members m
          left join member_profiles mp on mp.member_id = m.member_id
          where true ${statusClause} ${queryClause} ${cursorClause}
          order by m.created_at desc, m.member_id desc
          limit ${input.limit + 1}
        `);
        const hasMore = result.rows.length > input.limit;
        const rows = result.rows.slice(0, input.limit);
        const items = rows.map((row) => ({
          memberId: row.member_id,
          displayName: row.display_name,
          status: row.status as OpsMemberPage["items"][number]["status"],
          handle: row.handle,
          profileVisibility: row.profile_visibility,
          providers: row.providers,
          joinedAt: new Date(row.joined_at).toISOString(),
          lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
          activity: {
            votes: numberValue(row.votes),
            comments: numberValue(row.comments),
            issues: numberValue(row.issues),
          },
        }));
        const last = rows.at(-1);
        await audit({
          memberId: input.memberId,
          eventType: "OPS_MEMBERS_READ",
          outcome: "ALLOWED",
          requestId: input.requestId,
          metadata: { resultCount: items.length, status: input.status ?? "ALL", searched: !!query },
        });
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          items,
          nextCursor: hasMore && last ? encodeMemberCursor(last.joined_at, last.member_id) : null,
        };
      } catch (error) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_MEMBERS_READ",
          outcome: "FAILED",
          requestId: input.requestId,
          metadata: { reason: "READ_MODEL_FAILED" },
        }).catch(() => undefined);
        throw error;
      }
    },

    async readReportedMembers(input): Promise<OpsReportedMembersPage | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_REPORTED_MEMBERS_READ",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }

      const query = input.query?.trim();
      const queryClause = query
        ? sql`and (
            m.member_id::text ilike ${`${query}%`}
            or m.display_name ilike ${`%${query}%`}
          )`
        : sql``;
      const now = new Date();
      const result = await database.execute<{
        member_id: string;
        display_name: string;
        member_status: string;
        reports_7d: number;
        reporters_7d: number;
        targets_7d: number;
        reports_14d: number;
        reporters_14d: number;
        targets_14d: number;
        latest_report_at: Date | string;
        latest_submission_at: Date | string | null;
      }>(sql`
        with effective_reports as (
          select coalesce(issue_author.member_id, media.uploaded_by_member_id) as member_id,
            report.subject_id,
            report.target_type || ':' || report.target_id::text as target_key,
            report.created_at
          from content_reports report
          join report_cases report_case on report_case.report_case_id = report.report_case_id
          join report_clusters cluster on cluster.report_cluster_id = report.report_cluster_id
          left join issue_authors issue_author
            on report.target_type = 'ISSUE' and issue_author.issue_id = report.target_id
          left join issue_media_assets media
            on report.target_type = 'ISSUE_MEDIA' and media.media_asset_id = report.target_id
          where report.counted = true
            and report.created_at >= ${new Date(now.getTime() - 14 * 86_400_000)}
            and report_case.status <> 'DISMISSED'
            and cluster.classification <> 'COORDINATED_SUSPECTED'
        ), report_totals as (
          select member_id,
            count(*) filter (where created_at >= ${new Date(now.getTime() - 7 * 86_400_000)})::int
              as reports_7d,
            count(distinct subject_id) filter (
              where created_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
            )::int as reporters_7d,
            count(distinct target_key) filter (
              where created_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
            )::int as targets_7d,
            count(*)::int as reports_14d,
            count(distinct subject_id)::int as reporters_14d,
            count(distinct target_key)::int as targets_14d,
            max(created_at) as latest_report_at
          from effective_reports
          where member_id is not null
          group by member_id
        )
        select m.member_id, m.display_name, m.status::text as member_status,
          totals.reports_7d, totals.reporters_7d, totals.targets_7d,
          totals.reports_14d, totals.reporters_14d, totals.targets_14d,
          totals.latest_report_at,
          (select max(submission.submitted_at) from member_issue_submissions submission
            where submission.member_id = m.member_id
              and submission.submitted_at >= ${new Date(now.getTime() - 86_400_000)})
            as latest_submission_at
        from report_totals totals
        join members m on m.member_id = totals.member_id
        where true ${queryClause}
        order by totals.reporters_14d desc, totals.targets_14d desc,
          totals.latest_report_at desc, m.member_id desc
        limit ${Math.max(input.limit * 2, 100)}
      `);
      const items = result.rows
        .map((row) => {
          const issueAccess = evaluateMemberIssueAccessSignals({
            hardReporterCount: numberValue(row.reporters_14d),
            hardTargetCount: numberValue(row.targets_14d),
            latestHardReportAt: new Date(row.latest_report_at),
            softReporterCount: numberValue(row.reporters_7d),
            softTargetCount: numberValue(row.targets_7d),
            latestSubmissionAt: row.latest_submission_at
              ? new Date(row.latest_submission_at)
              : null,
            now,
          });
          return {
            memberId: row.member_id,
            displayName: row.display_name,
            memberStatus:
              row.member_status as OpsReportedMembersPage["items"][number]["memberStatus"],
            reports7d: numberValue(row.reports_7d),
            uniqueReporters7d: numberValue(row.reporters_7d),
            reportedTargets7d: numberValue(row.targets_7d),
            reports14d: numberValue(row.reports_14d),
            uniqueReporters14d: numberValue(row.reporters_14d),
            reportedTargets14d: numberValue(row.targets_14d),
            latestReportAt: new Date(row.latest_report_at).toISOString(),
            issueAccess,
          };
        })
        .filter((item) => !input.state || item.issueAccess.state === input.state)
        .slice(0, input.limit);
      await audit({
        memberId: input.memberId,
        eventType: "OPS_REPORTED_MEMBERS_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { resultCount: items.length, state: input.state ?? "ALL", searched: !!query },
      });
      return { schemaVersion: 1, generatedAt: now.toISOString(), items };
    },

    async readEditorial(input): Promise<OpsEditorialPage | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_READ",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }

      try {
        const state = await editorialReviewState();
        const storedRows = await database
          .select({
            candidateId: operatorEditorialDecisions.candidateId,
            status: operatorEditorialDecisions.status,
            note: operatorEditorialDecisions.note,
            reviewedBy: members.displayName,
            reviewedAt: operatorEditorialDecisions.reviewedAt,
            revision: operatorEditorialDecisions.revision,
            binaryFit: operatorEditorialDecisions.binaryFit,
            choiceParity: operatorEditorialDecisions.choiceParity,
            duplicateReview: operatorEditorialDecisions.duplicateReview,
            sourceReview: operatorEditorialDecisions.sourceReview,
          })
          .from(operatorEditorialDecisions)
          .innerJoin(members, eq(members.id, operatorEditorialDecisions.reviewedByMemberId))
          .where(eq(operatorEditorialDecisions.catalogId, state.catalog.id));
        const storedByCandidate = new Map(
          storedRows.map((row) => [row.candidateId, mapDecision(row)]),
        );
        const all = state.candidates
          .map((candidate) => {
            const baseline = candidate.decision
              ? {
                  status: candidate.decision.status,
                  note: candidate.decision.note,
                  reviewedBy: candidate.decision.reviewedBy,
                  reviewedAt: candidate.decision.reviewedAt,
                  revision: 0,
                  checks: candidate.decision.checks,
                }
              : null;
            const decision = storedByCandidate.get(candidate.candidateId) ?? baseline;
            return {
              candidateId: candidate.candidateId,
              question: candidate.question,
              context: candidate.context,
              choices: candidate.choices.map((choice) => ({
                code: choice.code,
                label: choice.label,
              })),
              category: candidate.category,
              interestCardCodes: candidate.interestCardCodes,
              editorialArea:
                typeof candidate.editorialArea === "string" ? candidate.editorialArea : "",
              riskLevel: String(candidate.riskLevel ?? ""),
              inventoryScope: candidate.inventoryScope,
              discoveryLead: candidate.sourceProfile.discoveryLead,
              sourceRequirement: candidate.sourceProfile.sourceRequirement,
              sources: candidate.sources.map((source) => ({
                id: source.id,
                kind: source.kind,
                title: source.title,
                url: source.url,
              })),
              automatedReviewStatus: candidate.automatedReview.status,
              decision,
            };
          })
          .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
        const counts: OpsEditorialPage["counts"] = {
          PENDING: 0,
          APPROVED: 0,
          NEEDS_CHANGES: 0,
          REJECTED: 0,
        };
        for (const candidate of all) counts[candidate.decision?.status ?? "PENDING"] += 1;
        const query = input.query?.trim().toLocaleLowerCase("ko") ?? "";
        const filtered = all.filter((candidate) => {
          const status = candidate.decision?.status ?? "PENDING";
          return (
            (!input.status || status === input.status) &&
            (!input.scope || candidate.inventoryScope === input.scope) &&
            (!query ||
              `${candidate.candidateId} ${candidate.question} ${candidate.context}`
                .toLocaleLowerCase("ko")
                .includes(query)) &&
            (!input.cursor || candidate.candidateId > input.cursor)
          );
        });
        const hasMore = filtered.length > input.limit;
        const items = filtered.slice(0, input.limit);
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_READ",
          outcome: "ALLOWED",
          requestId: input.requestId,
          metadata: {
            resultCount: items.length,
            status: input.status ?? "ALL",
            scope: input.scope ?? "ALL",
            searched: !!query,
          },
        });
        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          catalog: state.catalog,
          inventory: state.inventory,
          counts,
          items,
          nextCursor: hasMore ? (items.at(-1)?.candidateId ?? null) : null,
        };
      } catch (error) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_READ",
          outcome: "FAILED",
          requestId: input.requestId,
          metadata: { reason: "READ_MODEL_FAILED" },
        }).catch(() => undefined);
        throw error;
      }
    },

    async saveEditorialDecision(input): Promise<OpsEditorialDecision | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_DECISION_WRITE",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { candidateId: input.candidateId, reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }
      const state = await editorialReviewState();
      const baselineCandidate = state.candidates.find(
        (candidate) => candidate.candidateId === input.candidateId,
      );
      if (!baselineCandidate) throw new Error("The Editorial candidate does not exist.");
      if (input.status === "APPROVED" && Object.values(input.checks).some((value) => !value)) {
        throw new Error("승인하려면 네 가지 편집 검수 항목을 모두 확인해야 합니다.");
      }

      const readCurrent = async () => {
        const rows = await database
          .select({
            status: operatorEditorialDecisions.status,
            note: operatorEditorialDecisions.note,
            reviewedBy: members.displayName,
            reviewedAt: operatorEditorialDecisions.reviewedAt,
            revision: operatorEditorialDecisions.revision,
            binaryFit: operatorEditorialDecisions.binaryFit,
            choiceParity: operatorEditorialDecisions.choiceParity,
            duplicateReview: operatorEditorialDecisions.duplicateReview,
            sourceReview: operatorEditorialDecisions.sourceReview,
          })
          .from(operatorEditorialDecisions)
          .innerJoin(members, eq(members.id, operatorEditorialDecisions.reviewedByMemberId))
          .where(
            and(
              eq(operatorEditorialDecisions.catalogId, state.catalog.id),
              eq(operatorEditorialDecisions.candidateId, input.candidateId),
            ),
          )
          .limit(1);
        return rows[0] ? mapDecision(rows[0]) : null;
      };
      const current = await readCurrent();
      if ((current?.revision ?? 0) !== input.expectedRevision) {
        throw new OpsReviewConflictError(current);
      }

      try {
        const savedRow = await database.transaction(async (transaction) => {
          const values = {
            status: input.status,
            note: input.note,
            reviewedByMemberId: input.memberId,
            binaryFit: input.checks.binaryFit,
            choiceParity: input.checks.choiceParity,
            duplicateReview: input.checks.duplicateReview,
            sourceReview: input.checks.sourceReview,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          };
          if (current) {
            const updated = await transaction
              .update(operatorEditorialDecisions)
              .set({ ...values, revision: current.revision + 1 })
              .where(
                and(
                  eq(operatorEditorialDecisions.catalogId, state.catalog.id),
                  eq(operatorEditorialDecisions.candidateId, input.candidateId),
                  eq(operatorEditorialDecisions.revision, input.expectedRevision),
                ),
              )
              .returning();
            if (!updated[0]) throw new OpsReviewConflictError(await readCurrent());
            return updated[0];
          }
          const inserted = await transaction
            .insert(operatorEditorialDecisions)
            .values({
              ...values,
              catalogId: state.catalog.id,
              candidateId: input.candidateId,
              revision: 1,
            })
            .returning();
          return inserted[0]!;
        });
        const saved = mapDecision({ ...savedRow, reviewedBy: actor.displayName });
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_DECISION_WRITE",
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: {
            candidateId: input.candidateId,
            fromStatus: current?.status ?? baselineCandidate.decision?.status ?? "PENDING",
            toStatus: saved.status,
            revision: saved.revision,
          },
        });
        return saved;
      } catch (error) {
        const conflict = error instanceof OpsReviewConflictError ? error : null;
        await audit({
          memberId: input.memberId,
          eventType: "OPS_EDITORIAL_DECISION_WRITE",
          outcome: "FAILED",
          requestId: input.requestId,
          metadata: {
            candidateId: input.candidateId,
            reason: conflict ? "REVISION_CONFLICT" : "WRITE_FAILED",
          },
        }).catch(() => undefined);
        if (conflict) throw conflict;
        const latest = await readCurrent().catch(() => null);
        if ((latest?.revision ?? 0) !== input.expectedRevision) {
          throw new OpsReviewConflictError(latest);
        }
        throw error;
      }
    },

    async readPublishedIssues(input): Promise<OpsPublishedIssuePage | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_PUBLISHED_ISSUES_READ",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }
      const items = await publishedIssueRows(input);
      await audit({
        memberId: input.memberId,
        eventType: "OPS_PUBLISHED_ISSUES_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: {
          resultCount: items.length,
          state: input.state ?? "ALL",
          reportedOnly: input.reportedOnly ?? false,
          searched: Boolean(input.query?.trim()),
        },
      });
      return { schemaVersion: 1, generatedAt: new Date().toISOString(), items };
    },

    async updatePublishedIssue(input): Promise<OpsPublishedIssue | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_PUBLISHED_ISSUE_WRITE",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { issueId: input.issueId, reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }
      const reason = input.reason?.trim() || `OPERATOR_${input.action}`;
      const [current] = await publishedIssueRows({ issueId: input.issueId, limit: 1 });
      if (!current) throw new OpsPublishedIssueConflictError("게시 질문을 찾을 수 없습니다.");
      const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
      if (current.updatedAt !== expectedUpdatedAt.toISOString()) {
        throw new OpsPublishedIssueConflictError(
          "다른 운영 변경이 먼저 반영됐습니다. 목록을 새로고침해 주세요.",
        );
      }
      if (["RESOLVE_REPORTS", "DISMISS_REPORTS"].includes(input.action)) {
        if (!input.expectedReportCaseId || !input.expectedReportUpdatedAt) {
          throw new OpsPublishedIssueConflictError("신고 목록을 새로고침한 뒤 다시 처리해 주세요.");
        }
        const changedAt = new Date();
        const expectedReportUpdatedAt = new Date(input.expectedReportUpdatedAt);
        const status = input.action === "DISMISS_REPORTS" ? "DISMISSED" : "RESOLVED";
        const cases = await database
          .update(reportCases)
          .set({ status, updatedAt: changedAt, resolvedAt: changedAt })
          .where(
            and(
              eq(reportCases.targetType, "ISSUE"),
              eq(reportCases.targetId, input.issueId),
              eq(reportCases.id, input.expectedReportCaseId),
              inArray(reportCases.status, ["OPEN", "QUARANTINED", "PENDING_REVIEW"]),
              sql`date_trunc('milliseconds', ${reportCases.updatedAt}) = ${expectedReportUpdatedAt}`,
            ),
          )
          .returning({ id: reportCases.id });
        if (cases.length === 0) {
          throw new OpsPublishedIssueConflictError("처리할 열린 신고 건이 없습니다.");
        }
        await audit({
          memberId: input.memberId,
          eventType: "OPS_PUBLISHED_ISSUE_REPORT_REVIEW",
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: {
            issueId: input.issueId,
            action: input.action,
            reportCaseIds: cases.map((reportCase) => reportCase.id),
            reason,
          },
        });
        const [saved] = await publishedIssueRows({ issueId: input.issueId, limit: 1 });
        if (!saved) throw new Error("신고 처리 후 게시 질문을 다시 읽지 못했습니다.");
        return saved;
      }
      if (current.state === "REMOVED") {
        throw new OpsPublishedIssueConflictError("이미 게시 중단된 질문입니다.");
      }
      if (input.action === "RESTORE" && current.lifecycle !== "PUBLISHED") {
        throw new OpsPublishedIssueConflictError("종료되거나 제거된 질문은 복구할 수 없습니다.");
      }

      const changedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
      const next =
        input.action === "HIDE"
          ? {
              visibility: "SUSPENDED" as const,
              participation: "VOTING_SUSPENDED" as const,
              feedEligibility: "EXCLUDED" as const,
            }
          : input.action === "RESTORE"
            ? {
                visibility: "VISIBLE" as const,
                participation: "VOTING_OPEN" as const,
                feedEligibility: "ELIGIBLE" as const,
              }
            : {
                lifecycle: "RETIRED" as const,
                visibility: "REMOVED" as const,
                participation: "VOTING_CLOSED" as const,
                feedEligibility: "EXCLUDED" as const,
              };
      const resolvedReportCaseIds = await database.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(issues)
          .set({ ...next, updatedAt: changedAt })
          .where(
            and(
              eq(issues.id, input.issueId),
              sql`date_trunc('milliseconds', ${issues.updatedAt}) = ${expectedUpdatedAt}`,
            ),
          )
          .returning({ id: issues.id });
        if (!updated) {
          throw new OpsPublishedIssueConflictError(
            "다른 운영 변경이 먼저 반영됐습니다. 목록을 새로고침해 주세요.",
          );
        }
        if (input.action !== "HIDE" && input.action !== "REMOVE") return [];
        const cases = await transaction
          .update(reportCases)
          .set({ status: "RESOLVED", updatedAt: changedAt, resolvedAt: changedAt })
          .where(
            and(
              eq(reportCases.targetType, "ISSUE"),
              eq(reportCases.targetId, input.issueId),
              inArray(reportCases.status, ["OPEN", "QUARANTINED", "PENDING_REVIEW"]),
            ),
          )
          .returning({ id: reportCases.id });
        return cases.map((reportCase) => reportCase.id);
      });
      await audit({
        memberId: input.memberId,
        eventType: "OPS_PUBLISHED_ISSUE_WRITE",
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: {
          issueId: input.issueId,
          action: input.action,
          before: {
            lifecycle: current.lifecycle,
            visibility: current.visibility,
            participation: current.participation,
            feedEligibility: current.feedEligibility,
          },
          reason,
          resolvedReportCaseIds,
        },
      });
      const [saved] = await publishedIssueRows({ issueId: input.issueId, limit: 1 });
      if (!saved) throw new Error("변경된 게시 질문을 다시 읽지 못했습니다.");
      return saved;
    },

    async revisePublishedIssueMedia(input): Promise<OpsPublishedIssue | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_PUBLISHED_ISSUE_MEDIA_WRITE",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { issueId: input.issueId, reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }
      const reason = input.reason?.trim() || "OPERATOR_MEDIA_REVISION";
      const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
      const changedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));

      const revised = await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:ops-issue-media:${input.issueId}`}, 0))`,
        );
        const [issue] = await transaction
          .select({
            lifecycle: issues.lifecycle,
            updatedAt: issues.updatedAt,
          })
          .from(issues)
          .where(eq(issues.id, input.issueId))
          .limit(1)
          .for("update");
        if (!issue) throw new OpsPublishedIssueConflictError("게시 질문을 찾을 수 없습니다.");
        if (issue.lifecycle !== "PUBLISHED") {
          throw new OpsPublishedIssueConflictError("공개 중인 질문만 이미지를 수정할 수 있습니다.");
        }
        if (issue.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new OpsPublishedIssueConflictError(
            "다른 운영 변경이 먼저 반영됐습니다. 목록을 새로고침해 주세요.",
          );
        }

        const [currentVersion] = await transaction
          .select()
          .from(issueVersions)
          .where(
            and(
              eq(issueVersions.issueId, input.issueId),
              sql`${issueVersions.publishedAt} is not null`,
              sql`${issueVersions.publishedAt} <= now()`,
            ),
          )
          .orderBy(desc(issueVersions.version))
          .limit(1);
        if (!currentVersion || currentVersion.version !== input.expectedVersion) {
          throw new OpsPublishedIssueConflictError(
            "질문의 최신 버전이 변경됐습니다. 목록을 새로고침해 주세요.",
          );
        }
        const currentChoices = await transaction
          .select({ code: issueChoices.code, label: issueChoices.label })
          .from(issueChoices)
          .where(
            and(
              eq(issueChoices.issueId, input.issueId),
              eq(issueChoices.issueVersion, currentVersion.version),
            ),
          )
          .orderBy(asc(issueChoices.code));
        const requestedByCode = new Map(input.choices.map((choice) => [choice.code, choice]));
        if (
          currentChoices.length < 2 ||
          currentChoices.length !== input.choices.length ||
          currentChoices.some((choice) => !requestedByCode.has(choice.code)) ||
          input.choices.some(
            (choice) => choice.altText.trim().length < 2 || choice.altText.trim().length > 300,
          )
        ) {
          throw new OpsPublishedIssueConflictError(
            "모든 선택지에 승인된 이미지를 한 장씩 지정해 주세요.",
          );
        }
        const assetIds = input.choices.map((choice) => choice.assetId);
        const assets = await transaction
          .select({
            id: issueMediaAssets.id,
            storageState: issueMediaAssets.storageState,
            moderationState: issueMediaAssets.moderationState,
            rightsState: issueMediaAssets.rightsState,
          })
          .from(issueMediaAssets)
          .where(inArray(issueMediaAssets.id, assetIds));
        if (
          new Set(assets.map((asset) => asset.id)).size !== new Set(assetIds).size ||
          assets.some(
            (asset) =>
              asset.storageState !== "PUBLISHED" ||
              asset.moderationState !== "APPROVED" ||
              !["ASSERTED", "CLEARED"].includes(asset.rightsState),
          )
        ) {
          throw new OpsPublishedIssueConflictError(
            "검수 승인되어 공개 저장소에 있는 이미지만 질문에 적용할 수 있습니다.",
          );
        }

        const cards = await transaction
          .select({
            cardCode: issueInterestCards.cardCode,
            taxonomyVersion: issueInterestCards.taxonomyVersion,
            weight: issueInterestCards.weight,
          })
          .from(issueInterestCards)
          .where(
            and(
              eq(issueInterestCards.issueId, input.issueId),
              eq(issueInterestCards.issueVersion, currentVersion.version),
            ),
          );
        const [versionCounter] = await transaction
          .select({ value: sql<number>`max(${issueVersions.version})::int` })
          .from(issueVersions)
          .where(eq(issueVersions.issueId, input.issueId));
        const nextVersion = numberValue(versionCounter?.value) + 1;
        const nextChoices = currentChoices.map((choice) => ({
          id: randomUUID(),
          code: choice.code,
          label: choice.label,
        }));
        await transaction.insert(issueVersions).values({
          issueId: input.issueId,
          version: nextVersion,
          question: currentVersion.question,
          context: currentVersion.context,
          contentHash: currentVersion.contentHash,
          primaryCategoryCode: currentVersion.primaryCategoryCode,
          experienceModeCode: currentVersion.experienceModeCode,
          formatMode: currentVersion.formatMode,
          mediaMode: "OPTION_IMAGES",
          taxonomyVersion: currentVersion.taxonomyVersion,
          publishedAt: changedAt,
        });
        await transaction.insert(issueChoices).values(
          nextChoices.map((choice) => ({
            ...choice,
            issueId: input.issueId,
            issueVersion: nextVersion,
          })),
        );
        await transaction.insert(issueChoiceMedia).values(
          nextChoices.map((choice, index) => {
            const requested = requestedByCode.get(choice.code)!;
            return {
              issueId: input.issueId,
              issueVersion: nextVersion,
              choiceId: choice.id,
              mediaAssetId: requested.assetId,
              altText: requested.altText.trim(),
              cropMode: requested.cropMode,
              displayPosition: index,
              linkedByMemberId: input.memberId,
            };
          }),
        );
        if (cards.length > 0) {
          await transaction.insert(issueInterestCards).values(
            cards.map((card) => ({
              issueId: input.issueId,
              issueVersion: nextVersion,
              ...card,
            })),
          );
        }
        await transaction.insert(voteAggregates).values({
          issueId: input.issueId,
          issueVersion: nextVersion,
        });
        await transaction.insert(resultSnapshots).values({
          issueId: input.issueId,
          issueVersion: nextVersion,
          resultVersion: 1,
          acceptedACount: 0,
          acceptedBCount: 0,
          acceptedCCount: 0,
          acceptedDCount: 0,
          displayedVoteCount: 0,
          integrityState: "NORMAL",
        });
        const snapshot = await sealIssueVersionSnapshot(transaction, input.issueId, nextVersion);
        const publicationEventId = randomUUID();
        const aggregateId = `${input.issueId}:${nextVersion}`;
        await transaction.insert(outboxEvents).values([
          {
            id: publicationEventId,
            aggregateType: "ISSUE_VERSION",
            aggregateId,
            eventType: "ISSUE_PUBLISHED",
            schemaVersion: 1,
            occurredAt: changedAt,
            payload: {
              event_id: publicationEventId,
              event_type: "ISSUE_PUBLISHED",
              schema_version: 1,
              occurred_at: changedAt.toISOString(),
              aggregate_type: "ISSUE_VERSION",
              aggregate_id: aggregateId,
              data: {
                issue_id: input.issueId,
                issue_version: nextVersion,
                source: "OPS_MEDIA_REVISION",
                content_hash: currentVersion.contentHash,
              },
            },
          },
          ...createModerationSubmissionEvents({
            targetType: "ISSUE_VERSION",
            targetId: input.issueId,
            targetVersion: nextVersion,
            privateObjectReference: `issue://version/${input.issueId}/${nextVersion}`,
            normalizedInputHash: snapshot.inputHash,
            reason: "EDIT",
            occurredAt: changedAt,
          }).rows,
        ]);
        await transaction
          .update(issues)
          .set({ updatedAt: changedAt })
          .where(eq(issues.id, input.issueId));
        return { fromVersion: currentVersion.version, toVersion: nextVersion, assetIds };
      });

      await audit({
        memberId: input.memberId,
        eventType: "OPS_PUBLISHED_ISSUE_MEDIA_WRITE",
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { issueId: input.issueId, ...revised, reason },
      });
      const [saved] = await publishedIssueRows({ issueId: input.issueId, limit: 1 });
      if (!saved) throw new Error("이미지 수정본을 다시 읽지 못했습니다.");
      return saved;
    },
  };
}

function createOpsPointShopMethods(
  database: Database["db"],
  operator: (memberId: string) => Promise<{ memberId: string; displayName: string } | null>,
  audit: (input: {
    memberId: string;
    eventType?: string;
    outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
    windowDays?: OpsDashboardWindow;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>,
): OpsPointShopMethods {
  async function requireOperator(input: { memberId: string; requestId?: string }) {
    const actor = await operator(input.memberId);
    if (!actor) {
      await audit({
        memberId: input.memberId,
        eventType: "OPS_POINT_SHOP_ACCESS",
        outcome: "DENIED",
        requestId: input.requestId,
        metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
      });
    }
    return actor;
  }

  async function itemById(itemId: string) {
    const rows = await database
      .select(pointShopItemSelection())
      .from(pointCatalogItems)
      .where(eq(pointCatalogItems.id, itemId))
      .limit(1);
    return rows[0] ? mapPointShopItem(rows[0]) : null;
  }

  return {
    async readPointShop(input): Promise<OpsPointShopView | null> {
      const actor = await requireOperator(input);
      if (!actor) return null;

      const [rows, auditRows] = await Promise.all([
        database
          .select(pointShopItemSelection())
          .from(pointCatalogItems)
          .orderBy(desc(pointCatalogItems.updatedAt), desc(pointCatalogItems.createdAt)),
        database
          .select({
            id: operatorAuditLogs.id,
            eventType: operatorAuditLogs.eventType,
            outcome: operatorAuditLogs.outcome,
            operator: members.displayName,
            requestId: operatorAuditLogs.requestId,
            metadata: operatorAuditLogs.metadata,
            occurredAt: operatorAuditLogs.occurredAt,
          })
          .from(operatorAuditLogs)
          .innerJoin(members, eq(members.id, operatorAuditLogs.memberId))
          .where(inArray(operatorAuditLogs.eventType, [...pointShopAuditEvents]))
          .orderBy(desc(operatorAuditLogs.occurredAt))
          .limit(50),
      ]);

      await audit({
        memberId: input.memberId,
        eventType: "OPS_POINT_SHOP_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { itemCount: rows.length, auditCount: auditRows.length },
      });

      const items = rows.map(mapPointShopItem);
      const counts: OpsPointShopView["counts"] = { ACTIVE: 0, PAUSED: 0, RETIRED: 0 };
      for (const item of items) counts[item.status] += 1;
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        counts,
        items,
        audit: auditRows.map((row) => ({
          id: row.id,
          eventType: row.eventType as OpsPointShopView["audit"][number]["eventType"],
          outcome: row.outcome as OpsPointShopView["audit"][number]["outcome"],
          operator: row.operator,
          requestId: row.requestId,
          metadata: row.metadata,
          occurredAt: row.occurredAt.toISOString(),
        })),
      };
    },

    async createPointShopItem(input): Promise<OpsPointShopItem | null> {
      const actor = await requireOperator(input);
      if (!actor) return null;

      const createdAt = new Date();
      let itemId: string;
      try {
        itemId = await database.transaction(async (transaction) => {
          const [created] = await transaction
            .insert(pointCatalogItems)
            .values({
              code: input.code,
              itemType: "COSMETIC",
              surface: input.equipSlot === "SHARE_BACKGROUND" ? "SHARE_CARD" : "PROFILE",
              equipSlot: input.equipSlot,
              themeFamily: input.themeFamily,
              name: input.name,
              description: input.description,
              price: input.price,
              status: input.status,
              createdAt,
              updatedAt: createdAt,
            })
            .returning({ id: pointCatalogItems.id });
          if (!created) throw new Error("The point shop item was not created.");

          await transaction.insert(pointCatalogItemVersions).values({
            itemId: created.id,
            version: 1,
            assetManifest: {
              schemaVersion: 1,
              renderType: "TOKEN_THEME",
              themeFamily: input.themeFamily,
              equipSlot: input.equipSlot,
              choiceA: "#15C4D6",
              choiceB: "#FF7A1A",
            },
            previewAssets: { kind: "CSS_TOKEN_PREVIEW", themeFamily: input.themeFamily },
            accessibilityMetadata: {
              decorativeOnly: true,
              requiresTextContrast: true,
              reducedMotionSafe: true,
            },
            releaseNotes: `Ops catalog creation: ${input.reason}`.slice(0, 500),
          });
          await transaction.insert(operatorAuditLogs).values({
            memberId: input.memberId,
            eventType: "OPS_POINT_SHOP_ITEM_CREATED",
            outcome: "SUCCEEDED",
            requestId: input.requestId,
            metadata: {
              itemId: created.id,
              code: input.code,
              after: { price: input.price, status: input.status },
              reason: input.reason,
            },
          });
          return created.id;
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new OpsPointShopConflictError("이미 사용 중인 상품 코드입니다.");
        }
        throw error;
      }
      return itemById(itemId);
    },

    async updatePointShopItem(input): Promise<OpsPointShopItem | null> {
      const actor = await requireOperator(input);
      if (!actor) return null;

      await database.transaction(async (transaction) => {
        const [before] = await transaction
          .select({
            code: pointCatalogItems.code,
            price: pointCatalogItems.price,
            status: pointCatalogItems.status,
            opsRevision: pointCatalogItems.opsRevision,
          })
          .from(pointCatalogItems)
          .where(eq(pointCatalogItems.id, input.itemId))
          .limit(1);
        if (!before) throw new OpsPointShopConflictError("상품을 찾을 수 없습니다.");
        if (before.status === "RETIRED") {
          throw new OpsPointShopConflictError("Archive된 상품은 다시 판매할 수 없습니다.");
        }

        const changedAt = new Date();
        const [updated] = await transaction
          .update(pointCatalogItems)
          .set({
            price: input.price,
            status: input.status,
            opsRevision: input.expectedRevision + 1,
            updatedAt: changedAt,
          })
          .where(
            and(
              eq(pointCatalogItems.id, input.itemId),
              eq(pointCatalogItems.opsRevision, input.expectedRevision),
            ),
          )
          .returning({ id: pointCatalogItems.id });
        if (!updated) {
          throw new OpsPointShopConflictError(
            "다른 운영자가 먼저 상품을 변경했습니다. 목록을 새로고침해 주세요.",
          );
        }

        await transaction.insert(operatorAuditLogs).values({
          memberId: input.memberId,
          eventType: "OPS_POINT_SHOP_ITEM_UPDATED",
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: {
            itemId: input.itemId,
            code: before.code,
            before: { price: before.price, status: before.status },
            after: { price: input.price, status: input.status },
            reason: input.reason,
          },
        });
      });
      return itemById(input.itemId);
    },
  };
}

export function createOpsDashboardService(
  database: Database["db"],
  options: { releaseId: string; qualityRankerMode?: "OFF" | "SHADOW" | "LIVE" },
): OpsDashboardService {
  async function audit(input: {
    memberId: string;
    eventType?: string;
    outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
    windowDays?: OpsDashboardWindow;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await database.insert(operatorAuditLogs).values({
      memberId: input.memberId,
      eventType: input.eventType ?? "OPS_DASHBOARD_READ",
      outcome: input.outcome,
      requestId: input.requestId,
      windowDays: input.windowDays,
      metadata: input.metadata ?? {},
    });
  }

  async function operator(memberId: string) {
    const rows = await database
      .select({ memberId: members.id, displayName: members.displayName })
      .from(operatorAccessGrants)
      .innerJoin(members, eq(members.id, operatorAccessGrants.memberId))
      .where(
        and(
          eq(operatorAccessGrants.memberId, memberId),
          eq(operatorAccessGrants.role, "OPERATOR"),
          isNull(operatorAccessGrants.revokedAt),
          eq(members.status, "ACTIVE"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    ...createOpsManagementMethods(database, operator, audit),
    ...createOpsPointShopMethods(database, operator, audit),
    async recordSupportEmailEvent(input) {
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.eventId}, 0))`,
        );
        const [existing] = await transaction
          .select({ id: operatorAuditLogs.id })
          .from(operatorAuditLogs)
          .where(
            and(
              eq(operatorAuditLogs.eventType, "RESEND_SUPPORT_EMAIL_RECEIVED"),
              eq(operatorAuditLogs.requestId, input.eventId),
            ),
          )
          .limit(1);
        if (existing) return "REPLAYED" as const;

        await transaction.insert(operatorAuditLogs).values({
          eventType: "RESEND_SUPPORT_EMAIL_RECEIVED",
          outcome: "SUCCEEDED",
          requestId: input.eventId,
          metadata: {
            emailId: input.emailId,
            messageId: input.messageId,
            sender: input.sender,
            recipient: input.recipient,
            subject: input.subject,
            receivedAt: input.receivedAt,
            attachmentCount: input.attachmentCount,
            contentStored: false,
          },
        });
        return "RECORDED" as const;
      });
    },
    async readRankingPreview(input): Promise<OpsRankingPreview | null> {
      const actor = await operator(input.memberId);
      if (!actor) {
        await audit({
          memberId: input.memberId,
          eventType: "OPS_RANKING_PREVIEW_READ",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }
      const result = await database.execute<{
        recommendation_request_id: string;
        served_position: number;
        shadow_position: number | null;
        issue_id: string;
        question: string;
        category_code: string;
        served_score: number;
        quality_score: number;
        candidate_sources: string[];
        score_components: Record<string, number>;
        quality_eligible: boolean;
        eligibility_reasons: string[];
        controversy_eligible: boolean;
        ranking_reason: string;
        fallback_reason: string | null;
        created_at: Date | string;
      }>(sql`
        select ri.recommendation_request_id, ri.position as served_position,
          ri.shadow_position, ri.issue_id, iv.question,
          iv.primary_category_code as category_code, ri.score as served_score,
          ri.quality_score, ri.candidate_sources, ri.score_components,
          ri.quality_eligible, ri.eligibility_reasons, ri.controversy_eligible,
          rr.reason_code as ranking_reason, rr.fallback_reason, ri.created_at
        from recommendation_items ri
        join recommendation_requests rr
          on rr.recommendation_request_id = ri.recommendation_request_id
        join issue_versions iv
          on iv.issue_id = ri.issue_id and iv.issue_version = ri.issue_version
        where rr.policy_version = 'quality-feed-v1.0'
        order by ri.created_at desc, ri.recommendation_request_id desc, ri.position asc
        limit ${input.limit}
      `);
      await audit({
        memberId: input.memberId,
        eventType: "OPS_RANKING_PREVIEW_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { itemCount: result.rows.length },
      });
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        configuredMode: options.qualityRankerMode ?? "OFF",
        policyVersion: "quality-feed-v1.0",
        items: result.rows.map((row) => ({
          requestId: row.recommendation_request_id,
          servedPosition: Number(row.served_position),
          shadowPosition: row.shadow_position === null ? null : Number(row.shadow_position),
          issueId: row.issue_id,
          question: row.question,
          categoryCode: row.category_code,
          servedScore: Number(row.served_score),
          qualityScore: Number(row.quality_score),
          candidateSources: row.candidate_sources,
          scoreComponents: row.score_components,
          qualityEligible: row.quality_eligible,
          eligibilityReasons: row.eligibility_reasons,
          controversyEligible: row.controversy_eligible,
          rankingReason: row.ranking_reason,
          fallbackReason: row.fallback_reason,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      };
    },
    async readDashboard(input) {
      const grant = await database
        .select({ id: operatorAccessGrants.id })
        .from(operatorAccessGrants)
        .where(
          and(
            eq(operatorAccessGrants.memberId, input.memberId),
            eq(operatorAccessGrants.role, "OPERATOR"),
            isNull(operatorAccessGrants.revokedAt),
          ),
        )
        .limit(1);

      if (!grant[0]) {
        await audit({
          memberId: input.memberId,
          outcome: "DENIED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }

      try {
        const [
          migrationResult,
          outboxResult,
          backupResult,
          funnelResult,
          sourceVotesResult,
          excludedTrafficResult,
          productionContentResult,
          categoryResult,
          moderationResult,
          integrityResult,
          editorial,
        ] = await Promise.all([
          database.execute<{ applied: number; latest_applied_at: string | null }>(sql`
            select count(*)::int as applied,
              to_timestamp(max(created_at) / 1000.0)::text as latest_applied_at
            from drizzle.__drizzle_migrations
          `),
          database.execute<{
            total: number;
            pending: number;
            published: number;
            failed: number;
            oldest_pending_age_seconds: number | null;
          }>(sql`
            select count(*)::int as total,
              count(*) filter (where status = 'PENDING')::int as pending,
              count(*) filter (where status = 'PUBLISHED')::int as published,
              count(*) filter (where status = 'FAILED')::int as failed,
              extract(epoch from (transaction_timestamp() - min(occurred_at)
                filter (where status = 'PENDING')))::double precision as oldest_pending_age_seconds
            from outbox_events
          `),
          database.execute<{ confirmed_at: Date; backup_reference: string }>(sql`
            select confirmed_at, backup_reference
            from operator_backup_confirmations
            order by confirmed_at desc
            limit 1
          `),
          database.execute<{
            viewable: number;
            submit: number;
            accepted_sessions: number;
            accepted_votes: number;
            result: number;
            next: number;
            second_vote: number;
            refreshed_at: Date | null;
          }>(sql`
            select
              coalesce(sum(qualified_sessions), 0)::int as viewable,
              coalesce(sum(submit_sessions), 0)::int as submit,
              coalesce(sum(accepted_vote_sessions), 0)::int as accepted_sessions,
              coalesce(sum(accepted_votes), 0)::int as accepted_votes,
              coalesce(sum(result_sessions), 0)::int as result,
              coalesce(sum(next_issue_sessions), 0)::int as next,
              coalesce(sum(second_vote_sessions), 0)::int as second_vote,
              max(refreshed_at) as refreshed_at
            from analytics_daily_funnel_metrics_v2
            where metric_date >= ((now() at time zone 'UTC')::date
              - (${input.windowDays - 1} * interval '1 day'))::date
          `),
          database.execute<{ accepted: number }>(sql`
            select count(*)::int as accepted
            from votes v
            left join analytics_sessions s on s.analytics_session_id = v.analytics_session_id
            where v.integrity_state = 'ACCEPTED'
              and not v.is_test_subject
              and v.accepted_at >= (
                ((now() at time zone 'UTC')::date
                  - (${input.windowDays - 1} * interval '1 day'))::date at time zone 'UTC'
              )
              and s.traffic_class = 'PRODUCT'
              and not exists (
                select 1 from votes test_vote
                where test_vote.analytics_session_id = s.analytics_session_id
                  and test_vote.is_test_subject
              )
          `),
          database.execute<{ traffic_class: string; sessions: number }>(sql`
            select traffic_class, count(*)::int as sessions
            from analytics_sessions
            where last_activity_at >= now() - (${input.windowDays} * interval '1 day')
              and traffic_class <> 'PRODUCT'
            group by traffic_class
            order by traffic_class
          `),
          database.execute<{ eligible_issues: number; zero_exposure_issues: number }>(sql`
            select count(*)::int as eligible_issues,
              count(*) filter (where not exists (
                select 1
                from analytics_events e
                join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
                where e.issue_id = i.issue_id
                  and e.event_type = 'ISSUE_VIEWABLE_IMPRESSION'
                  and e.occurred_at >= now() - (${input.windowDays} * interval '1 day')
                  and s.traffic_class = 'PRODUCT'
              ))::int as zero_exposure_issues
            from issues i
            where i.lifecycle = 'PUBLISHED'
              and i.visibility = 'VISIBLE'
              and i.participation = 'VOTING_OPEN'
              and i.feed_eligibility = 'ELIGIBLE'
              and (i.vote_open_at is null or i.vote_open_at <= now())
              and (i.vote_close_at is null or i.vote_close_at > now())
          `),
          database.execute<{ category_code: string; issues: number }>(sql`
            select iv.primary_category_code as category_code, count(*)::int as issues
            from issues i
            join issue_versions iv on iv.issue_id = i.issue_id
              and iv.issue_version = (
                select max(candidate.issue_version) from issue_versions candidate
                where candidate.issue_id = i.issue_id and candidate.published_at is not null
              )
            where i.lifecycle = 'PUBLISHED'
              and i.visibility = 'VISIBLE'
              and i.participation = 'VOTING_OPEN'
              and i.feed_eligibility = 'ELIGIBLE'
            group by iv.primary_category_code
            order by iv.primary_category_code
          `),
          database.execute<{
            reports: number;
            reported_comments: number;
            queue_size: number;
            oldest_queue_hours: number;
            decisions: number;
            hidden: number;
            restored: number;
          }>(sql`
            select
              (select count(*)::int from comment_reports
                where counted and created_at >= now() - (${input.windowDays} * interval '1 day'))
                as reports,
              (select count(distinct comment_id)::int from comment_reports
                where counted and created_at >= now() - (${input.windowDays} * interval '1 day'))
                as reported_comments,
              (select count(*)::int from comments
                where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW')
                as queue_size,
              coalesce((select extract(epoch from (now() - min(updated_at))) / 3600 from comments
                where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW'), 0)
                ::double precision as oldest_queue_hours,
              (select count(*)::int from comment_moderation_decisions
                where decided_at >= now() - (${input.windowDays} * interval '1 day')) as decisions,
              (select count(*)::int from comment_moderation_decisions
                where action in ('HIDE', 'REMOVE_POLICY')
                  and decided_at >= now() - (${input.windowDays} * interval '1 day')) as hidden,
              (select count(*)::int from comment_moderation_decisions
                where action = 'RESTORE'
                  and decided_at >= now() - (${input.windowDays} * interval '1 day')) as restored
          `),
          database.execute<{
            accepted: number;
            review: number;
            rejected_duplicate: number;
            rejected_abuse: number;
            invalidated: number;
            incomplete_attempts: number;
            rate_limit_buckets: number;
          }>(sql`
            select
              count(*) filter (where integrity_state = 'ACCEPTED')::int as accepted,
              count(*) filter (where integrity_state = 'REVIEW')::int as review,
              count(*) filter (where integrity_state = 'REJECTED_DUPLICATE')::int
                as rejected_duplicate,
              count(*) filter (where integrity_state = 'REJECTED_ABUSE')::int as rejected_abuse,
              count(*) filter (where integrity_state = 'INVALIDATED')::int as invalidated,
              (select count(*)::int from vote_attempts
                where received_at >= now() - (${input.windowDays} * interval '1 day')
                  and completed_at is null and received_at < now() - interval '5 minutes')
                as incomplete_attempts,
              (select count(*)::int from auth_rate_limit_windows
                where window_started_at >= now() - (${input.windowDays} * interval '1 day'))
                as rate_limit_buckets
            from votes
            where created_at >= now() - (${input.windowDays} * interval '1 day')
              and not is_test_subject
          `),
          editorialSnapshot(),
        ]);

        const migration = migrationResult.rows[0]!;
        const outbox = outboxResult.rows[0]!;
        const backup = backupResult.rows[0];
        const funnel = funnelResult.rows[0]!;
        const sourceAcceptedVotes = numberValue(sourceVotesResult.rows[0]?.accepted);
        const aggregatedAcceptedVotes = numberValue(funnel.accepted_votes);
        const acceptedSessions = numberValue(funnel.accepted_sessions);
        const difference = aggregatedAcceptedVotes - sourceAcceptedVotes;
        const production = productionContentResult.rows[0]!;
        const moderation = moderationResult.rows[0]!;
        const integrity = integrityResult.rows[0]!;
        const categoryMinimum = editorial.readiness.coverage.activeByCategory;
        const categories = categoryResult.rows.map((row) => ({
          categoryCode: row.category_code,
          issues: numberValue(row.issues),
        }));
        const categoryCounts = new Map(categories.map((row) => [row.categoryCode, row.issues]));
        const belowMinimumCategories = Object.keys(categoryMinimum)
          .map((categoryCode) => ({
            categoryCode,
            issues: categoryCounts.get(categoryCode) ?? 0,
            minimum: 3,
          }))
          .filter((row) => row.issues < row.minimum);

        const warnings: Warning[] = [];
        const refreshedAt = funnel.refreshed_at?.toISOString() ?? null;
        if (!refreshedAt) {
          warnings.push({
            code: "ANALYTICS_NOT_AGGREGATED",
            severity: "WARNING",
            message: "공식 퍼널 집계 기록이 없습니다. analytics aggregate 작업을 확인하세요.",
          });
        } else if (Date.now() - new Date(refreshedAt).getTime() > 6 * 60 * 60 * 1000) {
          warnings.push({
            code: "ANALYTICS_STALE",
            severity: "WARNING",
            message: "공식 퍼널 집계가 6시간 이상 갱신되지 않았습니다.",
          });
        }
        if (difference !== 0) {
          warnings.push({
            code: "FUNNEL_RECONCILIATION_MISMATCH",
            severity: "CRITICAL",
            message: `집계 Accepted Vote와 원천 Vote가 ${Math.abs(difference)}건 다릅니다.`,
          });
        }
        if (numberValue(outbox.failed) > 0) {
          warnings.push({
            code: "OUTBOX_DEAD_LETTERS",
            severity: "CRITICAL",
            message: `Outbox 실패 이벤트가 ${numberValue(outbox.failed)}건 있습니다.`,
          });
        }
        if (nullableNumber(outbox.oldest_pending_age_seconds)! > 300) {
          warnings.push({
            code: "OUTBOX_BACKLOG_STALE",
            severity: "WARNING",
            message: "가장 오래된 Outbox 대기 이벤트가 5분을 초과했습니다.",
          });
        }
        if (!backup) {
          warnings.push({
            code: "BACKUP_CONFIRMATION_MISSING",
            severity: "WARNING",
            message: "운영 백업 확인 기록이 없습니다.",
          });
        }
        if (
          numberValue(moderation.queue_size) > 0 &&
          numberValue(moderation.oldest_queue_hours) > 24
        ) {
          warnings.push({
            code: "MODERATION_SLA_EXCEEDED",
            severity: "WARNING",
            message: "가장 오래된 댓글 검토 건이 24시간을 초과했습니다.",
          });
        }
        if (!editorial.readiness.ready || belowMinimumCategories.length > 0) {
          warnings.push({
            code: "CONTENT_SUPPLY_ATTENTION",
            severity: "WARNING",
            message: "콘텐츠 공급 정책 또는 운영 DB 카테고리 최소 수량을 확인해야 합니다.",
          });
        }

        const snapshot: OpsDashboardSnapshot = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          windowDays: input.windowDays,
          role: "OPERATOR",
          system: {
            releaseId: options.releaseId,
            apiReadiness: "READY",
            migrations: {
              applied: numberValue(migration.applied),
              latestAppliedAt: migration.latest_applied_at,
            },
            outbox: {
              total: numberValue(outbox.total),
              pending: numberValue(outbox.pending),
              published: numberValue(outbox.published),
              failed: numberValue(outbox.failed),
              oldestPendingAgeSeconds: nullableNumber(outbox.oldest_pending_age_seconds),
            },
            backup: {
              lastConfirmedAt: backup?.confirmed_at.toISOString() ?? null,
              reference: backup?.backup_reference ?? null,
            },
          },
          funnel: {
            officialPopulation:
              "PRODUCT analytics sessions only; TEST, OPERATOR, BOT, UNCLASSIFIED and test-subject votes excluded",
            refreshedAt,
            stages: {
              viewable: numberValue(funnel.viewable),
              submit: numberValue(funnel.submit),
              accepted: acceptedSessions,
              result: numberValue(funnel.result),
              next: numberValue(funnel.next),
              secondVote: numberValue(funnel.second_vote),
            },
            rates: {
              submitPerViewable: rate(numberValue(funnel.submit), numberValue(funnel.viewable)),
              acceptedPerSubmit: rate(acceptedSessions, numberValue(funnel.submit)),
              resultPerAccepted: rate(numberValue(funnel.result), acceptedSessions),
              nextPerResult: rate(numberValue(funnel.next), numberValue(funnel.result)),
              secondVotePerAccepted: rate(numberValue(funnel.second_vote), acceptedSessions),
            },
            reconciliation: {
              aggregatedAcceptedVotes,
              sourceAcceptedVotes,
              difference,
              status: difference === 0 ? "CONSISTENT" : "MISMATCH",
            },
            excludedSessions: excludedTrafficResult.rows.map((row) => ({
              trafficClass: row.traffic_class,
              sessions: numberValue(row.sessions),
            })),
          },
          content: {
            production: {
              eligibleIssues: numberValue(production.eligible_issues),
              zeroExposureIssues: numberValue(production.zero_exposure_issues),
              activeByCategory: categories,
              belowMinimumCategories,
            },
            editorial: {
              policyId: editorial.readiness.policyId,
              ready: editorial.readiness.ready,
              activeIssues: editorial.readiness.summary.activeIssues,
              reserveIssues: editorial.readiness.summary.approvedReserveIssues,
              longTermIssues: editorial.longTermIssues,
              dailyPublicationTarget: editorial.readiness.summary.dailyPublicationTarget,
              activeDaysOfSupply: editorial.readiness.summary.activeDaysOfSupply,
              reserveDaysOfSupply: editorial.readiness.summary.reserveDaysOfSupply,
              violationCount: editorial.readiness.violations.length,
            },
          },
          trust: {
            moderation: {
              reports: numberValue(moderation.reports),
              reportedComments: numberValue(moderation.reported_comments),
              queueSize: numberValue(moderation.queue_size),
              oldestQueueHours: numberValue(moderation.oldest_queue_hours),
              decisions: numberValue(moderation.decisions),
              hidden: numberValue(moderation.hidden),
              restored: numberValue(moderation.restored),
            },
            integrity: {
              acceptedVotes: numberValue(integrity.accepted),
              reviewVotes: numberValue(integrity.review),
              rejectedDuplicateVotes: numberValue(integrity.rejected_duplicate),
              rejectedAbuseVotes: numberValue(integrity.rejected_abuse),
              invalidatedVotes: numberValue(integrity.invalidated),
              incompleteVoteAttempts: numberValue(integrity.incomplete_attempts),
              authRateLimitBuckets: numberValue(integrity.rate_limit_buckets),
            },
          },
          warnings,
          runbooks: [
            { label: "배포·상태 확인", path: "docs/operations/public-v0-release-verification.md" },
            { label: "Outbox 복구", path: "docs/operations/outbox-publisher.md" },
            { label: "Issue Pack 발행", path: "docs/operations/issue-pack-publication.md" },
          ],
        };

        await audit({
          memberId: input.memberId,
          outcome: "ALLOWED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { warningCount: warnings.length },
        });
        return snapshot;
      } catch (error) {
        await audit({
          memberId: input.memberId,
          outcome: "FAILED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { reason: "READ_MODEL_FAILED" },
        }).catch(() => undefined);
        throw error;
      }
    },
  };
}

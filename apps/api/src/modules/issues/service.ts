import { randomUUID } from "node:crypto";

import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoices,
  issueChoiceMedia,
  issueAuthors,
  issueInterestCards,
  issueMediaAssets,
  guestMemberLinks,
  issues,
  issueVersions,
  memberProfiles,
  members,
  voteAggregates,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type { InterestCardCode } from "../interests/contracts.js";
import type { IssueReadService, PublicIssue, PublicIssueTally } from "./contracts.js";
import {
  decodeIssueFeedCursor,
  encodeIssueFeedCursor,
  encodePersonalizedIssueFeedCursor,
} from "./cursor.js";
import { IssueReadError } from "./errors.js";
import { publicProfileInitials } from "../identity/profile.js";
import { isGuestIssueAvailable } from "./policy.js";
import {
  RANKING_VERSION,
  type RankedIssue,
  type RankingProfile,
} from "../recommendations/contracts.js";
import { rankDiscoveryIssues, rankIssues } from "../recommendations/ranker.js";
import { loadRankingProfile, recordRecommendation } from "../recommendations/service.js";
import {
  issueMediaTreatmentEnabled,
  issueMediaViewerKey,
  type IssueMediaExperimentOptions,
} from "./media-experiment.js";

type IssueWithSourceMediaMode = Pick<PublicIssue, "id" | "version" | "choices" | "mediaMode"> & {
  sourceMediaMode: string;
};

function withoutSourceMediaMode<T extends IssueWithSourceMediaMode>(value: T) {
  const { sourceMediaMode, ...issue } = value;
  void sourceMediaMode;
  return issue;
}

async function withPublicChoiceMediaBatch<T extends IssueWithSourceMediaMode>(
  database: Database["db"],
  issuesToExpose: T[],
  mediaExperiment: IssueMediaExperimentOptions | undefined,
  viewerKey: string | undefined,
) {
  const eligibleIssues = issuesToExpose.filter(
    (issue) =>
      issue.sourceMediaMode === "OPTION_IMAGES" &&
      issueMediaTreatmentEnabled(mediaExperiment, viewerKey, issue.id),
  );
  const publicUrl = mediaExperiment?.publicUrl;
  if (!publicUrl || eligibleIssues.length === 0) {
    return issuesToExpose.map(withoutSourceMediaMode);
  }

  const issueFilters = eligibleIssues.map((issue) =>
    and(eq(issueChoiceMedia.issueId, issue.id), eq(issueChoiceMedia.issueVersion, issue.version)),
  );

  const rows = await database
    .select({
      choiceId: issueChoiceMedia.choiceId,
      altText: issueChoiceMedia.altText,
      cropMode: issueChoiceMedia.cropMode,
      objectKey: issueMediaAssets.publishedObjectKey,
      width: issueMediaAssets.outputWidth,
      height: issueMediaAssets.outputHeight,
    })
    .from(issueChoiceMedia)
    .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
    .where(
      and(
        or(...issueFilters),
        eq(issueMediaAssets.processingState, "READY"),
        eq(issueMediaAssets.moderationState, "APPROVED"),
        eq(issueMediaAssets.storageState, "PUBLISHED"),
        inArray(issueMediaAssets.rightsState, ["ASSERTED", "CLEARED"]),
        isNotNull(issueMediaAssets.publishedObjectKey),
      ),
    );

  const mediaByChoice = new Map(rows.map((row) => [row.choiceId, row]));
  return issuesToExpose.map((sourceIssue) => {
    const issue = withoutSourceMediaMode(sourceIssue);
    if (!eligibleIssues.some((eligible) => eligible.id === issue.id)) return issue;
    if (
      issue.choices.length !== 2 ||
      issue.choices.some((choice) => !mediaByChoice.has(choice.id))
    ) {
      return issue;
    }

    return {
      ...issue,
      mediaMode: "OPTION_IMAGES" as const,
      choices: issue.choices.map((choice) => {
        const media = mediaByChoice.get(choice.id)!;
        return {
          ...choice,
          media: {
            url: publicUrl(media.objectKey!),
            altText: media.altText,
            cropMode: media.cropMode as "COVER" | "CONTAIN",
            width: media.width,
            height: media.height,
          },
        };
      }),
    };
  });
}

export function createIssueReadService(
  database: Database["db"],
  options: {
    personalizationEnabled?: boolean;
    mediaExperiment?: IssueMediaExperimentOptions;
  } = {},
): IssueReadService {
  return {
    async getGuestIssue(issueId, viewer = {}) {
      const loaded = await database.transaction(async (transaction) => {
        const [issue] = await transaction
          .select({
            id: issues.id,
            lifecycle: issues.lifecycle,
            visibility: issues.visibility,
            participation: issues.participation,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
            voteOpenAt: issues.voteOpenAt,
            voteCloseAt: issues.voteCloseAt,
            resultVisibility: issues.resultVisibility,
          })
          .from(issues)
          .where(eq(issues.id, issueId))
          .limit(1);

        if (!issue) {
          throw new IssueReadError("ISSUE_NOT_FOUND", 404, "The requested Issue does not exist.");
        }

        if (!isGuestIssueAvailable(issue, new Date())) {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue is not currently available to Guests.",
          );
        }

        const [version] = await transaction
          .select({
            version: issueVersions.version,
            question: issueVersions.question,
            context: issueVersions.context,
            publishedAt: issueVersions.publishedAt,
            categoryCode: issueVersions.primaryCategoryCode,
            experienceModeCode: issueVersions.experienceModeCode,
            mediaMode: issueVersions.mediaMode,
          })
          .from(issueVersions)
          .where(and(eq(issueVersions.issueId, issueId), isNotNull(issueVersions.publishedAt)))
          .orderBy(desc(issueVersions.version))
          .limit(1);

        if (!version?.publishedAt) {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue has no published Version available.",
          );
        }

        const choices = await transaction
          .select({
            id: issueChoices.id,
            code: issueChoices.code,
            label: issueChoices.label,
          })
          .from(issueChoices)
          .where(
            and(eq(issueChoices.issueId, issueId), eq(issueChoices.issueVersion, version.version)),
          )
          .orderBy(issueChoices.code);

        if (choices.length !== 2 || choices[0]?.code !== "A" || choices[1]?.code !== "B") {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue does not have a complete A/B Choice set.",
          );
        }

        const [author] = await transaction
          .select({
            displayName: members.displayName,
            handle: memberProfiles.handle,
            avatarUrl: members.avatarUrl,
          })
          .from(issueAuthors)
          .innerJoin(memberProfiles, eq(issueAuthors.memberId, memberProfiles.memberId))
          .innerJoin(members, eq(issueAuthors.memberId, members.id))
          .where(
            and(
              eq(issueAuthors.issueId, issueId),
              eq(memberProfiles.visibility, "PUBLIC"),
              eq(members.status, "ACTIVE"),
            ),
          )
          .limit(1);

        let tally: PublicIssueTally | null = null;
        if (issue.resultVisibility === "RESULT_VISIBLE") {
          const [aggregate] = await transaction
            .select()
            .from(voteAggregates)
            .where(
              and(
                eq(voteAggregates.issueId, issueId),
                eq(voteAggregates.issueVersion, version.version),
              ),
            )
            .limit(1);

          if (aggregate) {
            tally = {
              resultVersion: aggregate.resultVersion,
              acceptedA: aggregate.acceptedACount,
              acceptedB: aggregate.acceptedBCount,
              displayedTotal: aggregate.displayedVoteCount,
              integrityState: aggregate.integrityState,
            };
          }
        }

        return {
          id: issue.id,
          version: version.version,
          question: version.question,
          context: version.context,
          publishedAt: version.publishedAt.toISOString(),
          categoryCode: version.categoryCode,
          experienceModeCode: version.experienceModeCode,
          choices: choices.map((choice) => ({ ...choice, media: null })),
          mediaMode: "TEXT_ONLY" as const,
          author: author
            ? {
                displayName: author.displayName,
                handle: author.handle,
                avatar: author.avatarUrl
                  ? { kind: "IMAGE" as const, url: author.avatarUrl }
                  : {
                      kind: "INITIALS" as const,
                      initials: publicProfileInitials(author.displayName),
                    },
              }
            : null,
          result: {
            visibility: issue.resultVisibility,
            tally,
          },
          sourceMediaMode: version.mediaMode,
        };
      });
      const [issue] = await withPublicChoiceMediaBatch(
        database,
        [loaded],
        options.mediaExperiment,
        issueMediaViewerKey(viewer),
      );
      return issue!;
    },

    async listGuestIssues(query) {
      const cursor = query.cursor ? decodeIssueFeedCursor(query.cursor) : null;
      let profile: RankingProfile;
      try {
        profile = await loadRankingProfile(database, {
          anonymousSubjectId: query.anonymousSubjectId,
          sessionToken: query.sessionToken,
          enabled: options.personalizationEnabled ?? false,
        });
      } catch {
        profile = {
          subjectId: null,
          profileVersion: null,
          selectedCardCodes: [],
          mode: "RECENCY",
          reasonCode: "RANKER_FALLBACK",
        };
      }

      if (cursor?.mode === "PERSONALIZED") {
        if (profile.mode !== "PERSONALIZED" || profile.profileVersion !== cursor.profileVersion) {
          throw new IssueReadError(
            "STALE_RANKING_CURSOR",
            409,
            "The Interest Profile changed. Restart the Feed from the first page.",
          );
        }
      } else if (cursor?.mode === "RECENCY" && profile.mode === "PERSONALIZED") {
        profile = { ...profile, mode: "RECENCY", reasonCode: "RANKER_FALLBACK" };
      }

      const rankingRequestId = randomUUID();
      const rankingSeed = cursor?.rankingSeed ?? randomUUID();
      const legacyRecencyCursor =
        cursor?.mode === "RECENCY" && (!cursor.rankingSeed || cursor.score === undefined);
      const discoveryRanking =
        (options.personalizationEnabled ?? false) &&
        profile.mode === "RECENCY" &&
        !legacyRecencyCursor &&
        (Boolean(cursor?.rankingSeed) || profile.reasonCode === "PROFILE_NOT_READY");
      const seededRanking = profile.mode === "PERSONALIZED" || discoveryRanking;
      const result = await database.transaction(async (transaction) => {
        const now = new Date();
        const latestPublishedVersions = transaction
          .selectDistinctOn([issueVersions.issueId], {
            issueId: issueVersions.issueId,
            version: issueVersions.version,
            question: issueVersions.question,
            publishedAt: issueVersions.publishedAt,
            categoryCode: issueVersions.primaryCategoryCode,
            mediaMode: issueVersions.mediaMode,
          })
          .from(issueVersions)
          .where(and(isNotNull(issueVersions.publishedAt), lte(issueVersions.publishedAt, now)))
          .orderBy(issueVersions.issueId, desc(issueVersions.version))
          .as("latest_published_versions");

        const filters: SQL[] = [
          eq(issues.lifecycle, "PUBLISHED"),
          eq(issues.visibility, "VISIBLE"),
          eq(issues.participation, "VOTING_OPEN"),
          eq(issues.feedEligibility, "ELIGIBLE"),
          eq(issues.riskLevel, "LOW"),
          eq(issues.isPolitical, false),
          or(isNull(issues.voteOpenAt), lte(issues.voteOpenAt, now))!,
          or(isNull(issues.voteCloseAt), gt(issues.voteCloseAt, now))!,
          exists(
            transaction
              .select({ id: issueChoices.id })
              .from(issueChoices)
              .where(
                and(
                  eq(issueChoices.issueId, issues.id),
                  eq(issueChoices.issueVersion, latestPublishedVersions.version),
                  eq(issueChoices.code, "A"),
                ),
              ),
          ),
          exists(
            transaction
              .select({ id: issueChoices.id })
              .from(issueChoices)
              .where(
                and(
                  eq(issueChoices.issueId, issues.id),
                  eq(issueChoices.issueVersion, latestPublishedVersions.version),
                  eq(issueChoices.code, "B"),
                ),
              ),
          ),
        ];

        if (query.excludeIssueId) {
          filters.push(ne(issues.id, query.excludeIssueId));
        }

        if (legacyRecencyCursor) {
          filters.push(
            or(
              lt(latestPublishedVersions.publishedAt, cursor.publishedAt),
              and(
                eq(latestPublishedVersions.publishedAt, cursor.publishedAt),
                lt(issues.id, cursor.issueId),
              ),
            )!,
          );
        }

        let subjectId = profile.subjectId;
        if (!subjectId && query.anonymousSubjectId) {
          const [subject] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId))
            .limit(1);

          subjectId = subject?.id ?? null;
        }

        if (subjectId) {
          const excludedSubjectIds = new Set<string>([subjectId]);
          const [viewerSubject] = await transaction
            .select({ kind: voterSubjects.kind, userId: voterSubjects.userId })
            .from(voterSubjects)
            .where(eq(voterSubjects.id, subjectId))
            .limit(1);
          const memberId =
            viewerSubject?.userId &&
            (viewerSubject.kind === "MEMBER" || viewerSubject.kind === "VERIFIED_MEMBER")
              ? viewerSubject.userId
              : null;

          if (memberId) {
            const [memberSubjects, linkedGuestSubjects] = await Promise.all([
              transaction
                .select({ id: voterSubjects.id })
                .from(voterSubjects)
                .where(
                  and(
                    eq(voterSubjects.userId, memberId),
                    inArray(voterSubjects.kind, ["MEMBER", "VERIFIED_MEMBER"]),
                  ),
                ),
              transaction
                .select({ id: guestMemberLinks.guestSubjectId })
                .from(guestMemberLinks)
                .where(eq(guestMemberLinks.memberId, memberId)),
            ]);
            for (const memberSubject of memberSubjects) excludedSubjectIds.add(memberSubject.id);
            for (const guestSubject of linkedGuestSubjects) excludedSubjectIds.add(guestSubject.id);

            if (query.anonymousSubjectId) {
              const [currentGuest] = await transaction
                .select({ id: voterSubjects.id })
                .from(voterSubjects)
                .where(
                  and(
                    eq(voterSubjects.kind, "GUEST"),
                    eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId),
                  ),
                )
                .limit(1);
              if (currentGuest) {
                const [currentGuestLink] = await transaction
                  .select({ memberId: guestMemberLinks.memberId })
                  .from(guestMemberLinks)
                  .where(eq(guestMemberLinks.guestSubjectId, currentGuest.id))
                  .limit(1);
                if (!currentGuestLink || currentGuestLink.memberId === memberId) {
                  excludedSubjectIds.add(currentGuest.id);
                }
              }
            }
          }

          filters.push(
            notExists(
              transaction
                .select({ id: votes.id })
                .from(votes)
                .where(
                  and(
                    eq(votes.issueId, issues.id),
                    inArray(votes.subjectId, [...excludedSubjectIds]),
                    eq(votes.integrityState, "ACCEPTED"),
                  ),
                ),
            ),
          );
        }

        const candidateLimit = seededRanking ? 200 : query.limit + 1;
        const candidateRows = await transaction
          .select({
            id: issues.id,
            version: latestPublishedVersions.version,
            question: latestPublishedVersions.question,
            publishedAt: latestPublishedVersions.publishedAt,
            categoryCode: latestPublishedVersions.categoryCode,
            mediaMode: latestPublishedVersions.mediaMode,
          })
          .from(issues)
          .innerJoin(latestPublishedVersions, eq(latestPublishedVersions.issueId, issues.id))
          .where(and(...filters))
          .orderBy(desc(latestPublishedVersions.publishedAt), desc(issues.id))
          .limit(candidateLimit);

        const mappingFilters = candidateRows.map((row) =>
          and(
            eq(issueInterestCards.issueId, row.id),
            eq(issueInterestCards.issueVersion, row.version),
          ),
        );
        const mappings = mappingFilters.length
          ? await transaction
              .select({
                issueId: issueInterestCards.issueId,
                issueVersion: issueInterestCards.issueVersion,
                cardCode: issueInterestCards.cardCode,
                weight: issueInterestCards.weight,
              })
              .from(issueInterestCards)
              .where(or(...mappingFilters))
          : [];
        const weightsByIssue = new Map<string, RankedIssue["cardWeights"]>();
        for (const mapping of mappings) {
          const key = `${mapping.issueId}:${mapping.issueVersion}`;
          const weights = weightsByIssue.get(key) ?? new Map<InterestCardCode, number>();
          weights.set(mapping.cardCode as InterestCardCode, mapping.weight);
          weightsByIssue.set(key, weights);
        }

        let rankedRows: RankedIssue[];
        if (profile.mode === "PERSONALIZED") {
          try {
            rankedRows = rankIssues(
              candidateRows.map((row) => ({
                id: row.id,
                version: row.version,
                publishedAt: row.publishedAt!,
                cardWeights: weightsByIssue.get(`${row.id}:${row.version}`) ?? new Map(),
              })),
              profile.selectedCardCodes,
              subjectId,
              profile.profileVersion,
              rankingSeed,
            );
          } catch {
            profile = { ...profile, mode: "RECENCY", reasonCode: "RANKER_FALLBACK" };
            rankedRows = candidateRows.map((row) => ({
              id: row.id,
              version: row.version,
              publishedAt: row.publishedAt!,
              cardWeights: new Map(),
              score: 0,
              explorationScore: 0,
              reasonCodes: ["RECENT_FALLBACK"],
              matchedCardCodes: [],
            }));
          }
        } else if (discoveryRanking) {
          rankedRows = rankDiscoveryIssues(
            candidateRows.map((row) => ({
              id: row.id,
              version: row.version,
              publishedAt: row.publishedAt!,
              cardWeights: weightsByIssue.get(`${row.id}:${row.version}`) ?? new Map(),
            })),
            rankingSeed,
          );
        } else {
          rankedRows = candidateRows.map((row) => ({
            id: row.id,
            version: row.version,
            publishedAt: row.publishedAt!,
            cardWeights: new Map(),
            score: 0,
            explorationScore: 0,
            reasonCodes: ["RECENT_FALLBACK"],
            matchedCardCodes: [],
          }));
        }

        const cursorScore = cursor?.score;
        if (
          (cursor?.mode === "PERSONALIZED" || (cursor?.mode === "RECENCY" && cursor.rankingSeed)) &&
          cursorScore !== undefined
        ) {
          rankedRows = rankedRows.filter(
            (row) =>
              row.score < cursorScore ||
              (row.score === cursorScore && row.publishedAt < cursor.publishedAt) ||
              (row.score === cursorScore &&
                row.publishedAt.valueOf() === cursor.publishedAt.valueOf() &&
                row.id < cursor.issueId),
          );
        }

        const hasMore = rankedRows.length > query.limit;
        const pageRankedRows = rankedRows.slice(0, query.limit);
        const pageRows = pageRankedRows.map((ranked) => {
          const row = candidateRows.find(
            (candidate) => candidate.id === ranked.id && candidate.version === ranked.version,
          )!;
          return { ...row, ranked };
        });
        const choiceFilters = pageRows.map((row) =>
          and(eq(issueChoices.issueId, row.id), eq(issueChoices.issueVersion, row.version)),
        );
        const choices = choiceFilters.length
          ? await transaction
              .select({
                id: issueChoices.id,
                issueId: issueChoices.issueId,
                issueVersion: issueChoices.issueVersion,
                code: issueChoices.code,
                label: issueChoices.label,
              })
              .from(issueChoices)
              .where(or(...choiceFilters))
              .orderBy(issueChoices.issueId, issueChoices.code)
          : [];

        const items = pageRows.map((row) => ({
          id: row.id,
          version: row.version,
          question: row.question,
          publishedAt: row.publishedAt!.toISOString(),
          categoryCode: row.categoryCode,
          choices: choices
            .filter((choice) => choice.issueId === row.id && choice.issueVersion === row.version)
            .map(({ id, code, label }) => ({ id, code, label, media: null })),
          mediaMode: "TEXT_ONLY" as const,
          sourceMediaMode: row.mediaMode,
          recommendation: {
            requestId: rankingRequestId,
            score: row.ranked.score,
            reasonCodes: row.ranked.reasonCodes,
            matchedCardCodes: row.ranked.matchedCardCodes,
          },
        }));
        const lastItem = pageRows.at(-1);
        const ranking = {
          requestId: rankingRequestId,
          version: RANKING_VERSION,
          mode: profile.mode,
          reasonCode: profile.reasonCode,
          profileVersion: profile.profileVersion,
        } as const;

        return {
          items,
          nextCursor:
            hasMore && lastItem?.publishedAt
              ? profile.mode === "PERSONALIZED" && profile.profileVersion
                ? encodePersonalizedIssueFeedCursor({
                    mode: "PERSONALIZED",
                    rankingVersion: RANKING_VERSION,
                    rankingSeed,
                    profileVersion: profile.profileVersion,
                    score: lastItem.ranked.score,
                    publishedAt: lastItem.publishedAt,
                    issueId: lastItem.id,
                  })
                : encodeIssueFeedCursor(
                    discoveryRanking
                      ? {
                          mode: "RECENCY",
                          rankingVersion: RANKING_VERSION,
                          rankingSeed,
                          score: lastItem.ranked.score,
                          publishedAt: lastItem.publishedAt,
                          issueId: lastItem.id,
                        }
                      : {
                          mode: "RECENCY",
                          publishedAt: lastItem.publishedAt,
                          issueId: lastItem.id,
                        },
                  )
              : null,
          ranking,
          auditItems: pageRankedRows,
          subjectId,
        };
      });

      await recordRecommendation(
        database,
        result.ranking,
        result.subjectId,
        result.auditItems,
      ).catch(() => undefined);
      const items = await withPublicChoiceMediaBatch(
        database,
        result.items,
        options.mediaExperiment,
        issueMediaViewerKey(query),
      );
      return {
        items,
        nextCursor: result.nextCursor,
        ranking: result.ranking,
      };
    },
  };
}

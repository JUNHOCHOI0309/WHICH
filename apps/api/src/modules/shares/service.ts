import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoices,
  issues,
  issueVersions,
  resultSnapshots,
  shareCards,
} from "../../database/schema/index.js";
import { isGuestIssueAvailable } from "../issues/policy.js";
import {
  SHARE_VERSION,
  type CreateShareCardCommand,
  type PublicShareCard,
  type ShareCardService,
} from "./contracts.js";
import { ShareCardError } from "./errors.js";

type ShareRow = {
  id: string;
  version: string;
  channel: string;
  sharedChoiceCode: "A" | "B" | null;
  createdAt: Date;
  issueId: string;
  issueVersion: number;
  question: string;
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState:
    "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
};

function publicShareCard(
  row: ShareRow,
  choices: Array<{ code: "A" | "B"; label: string }>,
): PublicShareCard {
  return {
    id: row.id,
    version: SHARE_VERSION,
    channel: row.channel as PublicShareCard["channel"],
    shareType: row.sharedChoiceCode ? "RESULT_WITH_CHOICE" : "RESULT",
    sharedChoiceCode: row.sharedChoiceCode,
    createdAt: row.createdAt.toISOString(),
    issue: {
      id: row.issueId,
      version: row.issueVersion,
      question: row.question,
      choices,
    },
    result: {
      resultVersion: row.resultVersion,
      acceptedA: row.acceptedA,
      acceptedB: row.acceptedB,
      displayedTotal: row.displayedTotal,
      integrityState: row.integrityState,
    },
  };
}

export function createShareCardService(
  database: Database["db"],
  options: { enabled: boolean },
): ShareCardService {
  function assertEnabled() {
    if (!options.enabled) {
      throw new ShareCardError("SHARING_DISABLED", 404, "Result sharing is not enabled.");
    }
  }

  async function getChoices(issueId: string, issueVersion: number) {
    return database
      .select({ code: issueChoices.code, label: issueChoices.label })
      .from(issueChoices)
      .where(and(eq(issueChoices.issueId, issueId), eq(issueChoices.issueVersion, issueVersion)))
      .orderBy(issueChoices.code);
  }

  async function readShareCard(shareCardId: string) {
    const [row] = await database
      .select({
        id: shareCards.id,
        version: shareCards.version,
        channel: shareCards.channel,
        sharedChoiceCode: shareCards.sharedChoiceCode,
        createdAt: shareCards.createdAt,
        issueId: shareCards.issueId,
        issueVersion: shareCards.issueVersion,
        question: issueVersions.question,
        resultVersion: resultSnapshots.resultVersion,
        acceptedA: resultSnapshots.acceptedACount,
        acceptedB: resultSnapshots.acceptedBCount,
        displayedTotal: resultSnapshots.displayedVoteCount,
        integrityState: resultSnapshots.integrityState,
      })
      .from(shareCards)
      .innerJoin(
        issueVersions,
        and(
          eq(issueVersions.issueId, shareCards.issueId),
          eq(issueVersions.version, shareCards.issueVersion),
        ),
      )
      .innerJoin(resultSnapshots, eq(resultSnapshots.id, shareCards.tallySnapshotId))
      .innerJoin(issues, eq(issues.id, shareCards.issueId))
      .where(
        and(
          eq(shareCards.id, shareCardId),
          eq(issues.lifecycle, "PUBLISHED"),
          eq(issues.visibility, "VISIBLE"),
          eq(issues.riskLevel, "LOW"),
          eq(issues.isPolitical, false),
        ),
      )
      .limit(1);

    if (!row || row.version !== SHARE_VERSION) {
      throw new ShareCardError("SHARE_CARD_NOT_FOUND", 404, "The Share Card was not found.");
    }
    const choices = await getChoices(row.issueId, row.issueVersion);
    if (choices.length !== 2) {
      throw new ShareCardError("SHARE_CARD_NOT_FOUND", 404, "The Share Card was not found.");
    }
    return publicShareCard(row, choices);
  }

  return {
    async createShareCard(command: CreateShareCardCommand) {
      assertEnabled();
      const shareCardId = await database.transaction(async (transaction) => {
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
          })
          .from(issues)
          .where(eq(issues.id, command.issueId))
          .limit(1);
        const [version] = await transaction
          .select({ publishedAt: issueVersions.publishedAt })
          .from(issueVersions)
          .where(
            and(
              eq(issueVersions.issueId, command.issueId),
              eq(issueVersions.version, command.issueVersion),
            ),
          )
          .limit(1);

        if (!issue || !version?.publishedAt || !isGuestIssueAvailable(issue, new Date())) {
          throw new ShareCardError(
            "ISSUE_NOT_SHAREABLE",
            409,
            "The Issue is not eligible for sharing.",
          );
        }

        const [snapshot] = await transaction
          .select({ id: resultSnapshots.id, integrityState: resultSnapshots.integrityState })
          .from(resultSnapshots)
          .where(
            and(
              eq(resultSnapshots.issueId, command.issueId),
              eq(resultSnapshots.issueVersion, command.issueVersion),
              eq(resultSnapshots.resultVersion, command.resultVersion),
            ),
          )
          .orderBy(desc(resultSnapshots.calculatedAt))
          .limit(1);
        if (
          !snapshot ||
          ["DEGRADED", "UNDER_REVIEW", "RESULT_LOCKED"].includes(snapshot.integrityState)
        ) {
          throw new ShareCardError(
            "RESULT_SNAPSHOT_NOT_FOUND",
            409,
            "A shareable Result Snapshot was not found.",
          );
        }

        const [created] = await transaction
          .insert(shareCards)
          .values({
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            tallySnapshotId: snapshot.id,
            channel: command.channel,
            sharedChoiceCode: command.sharedChoiceCode,
          })
          .returning({ id: shareCards.id });
        return created!.id;
      });

      return readShareCard(shareCardId);
    },

    async getShareCard(shareCardId: string) {
      assertEnabled();
      return readShareCard(shareCardId);
    },
  };
}

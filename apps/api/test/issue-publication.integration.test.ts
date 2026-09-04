import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueChoiceMedia,
  issueChoices,
  issueMediaAssets,
  issues,
  issueVersions,
  members,
  operatorEditorialCandidateMedia,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
} from "../src/database/schema/index.js";
import {
  parseIssueManifest,
  type IssueManifest,
} from "../src/modules/issue-publication/manifest.js";
import {
  IssuePublicationConflictError,
  planIssuePublication,
  publishIssueManifest,
} from "../src/modules/issue-publication/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { computeManifestDigest } from "../src/modules/issue-publication/content-hash.js";
import { createTestDatabase } from "./helpers/test-database.js";

const manifestPath = fileURLToPath(
  new URL("../content/issue-packs/which-19-initial-low-v1.json", import.meta.url),
);

let database: Database;
let dropDatabase: () => Promise<void>;
let manifest: IssueManifest;
let manifestDigest: string;

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const source = await readFile(manifestPath);
  manifestDigest = computeManifestDigest(source);
  manifest = parseIssueManifest(JSON.parse(source.toString("utf8")) as unknown);
  const issue = manifest.issues[0]!;
  const [operator] = await database.db
    .insert(members)
    .values({ displayName: "Publication media operator" })
    .returning({ id: members.id });
  const assets = await database.db
    .insert(issueMediaAssets)
    .values(
      issue.choices.map((choice, index) => ({
        uploadedByMemberId: operator!.id,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: `Operator owns and approves publication rights for Choice ${choice.code}.`,
        rightsAttestedAt: new Date(),
        sha256: String(index + 1).repeat(64),
        perceptualHash: String(index + 1).repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 100,
        inputHeight: 100,
        outputByteSize: 80,
        outputWidth: 100,
        outputHeight: 100,
        moderationState: "APPROVED",
        storageState: "PUBLISHED",
        rightsState: "ASSERTED",
        publishedObjectKey: `issue-media/published/publication-${choice.code}.webp`,
        publishedAt: new Date(),
      })),
    )
    .returning({ id: issueMediaAssets.id });
  await database.db.insert(operatorEditorialCandidateMedia).values(
    issue.choices.map((choice, index) => ({
      catalogId: "publication-test-catalog",
      candidateId: `PUBLICATION-TEST-${index}`,
      choiceCode: choice.code,
      targetIssueId: issue.id,
      targetIssueVersion: issue.version,
      targetChoiceId: choice.id,
      mediaAssetId: assets[index]!.id,
      altText: `${choice.label} 선택지 이미지`,
      cropMode: "COVER",
      linkedByMemberId: operator!.id,
    })),
  );
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("WHICH-19 production Issue publication", () => {
  it("keeps dry-run read-only and reports all twelve Creates", async () => {
    const plan = await planIssuePublication(database.db, manifest, manifestDigest);

    expect(plan.manifestDigest).toBe(manifestDigest);
    expect(plan.summary).toEqual({ create: 12, noOp: 0, conflict: 0 });
    expect(await database.db.select().from(issues)).toHaveLength(0);
    expect(await database.db.select().from(issueVersions)).toHaveLength(0);
    expect(await database.db.select().from(issueChoices)).toHaveLength(0);
  });

  it("publishes the complete Pack and zero-result baselines in one transaction", async () => {
    const result = await publishIssueManifest(database.db, manifest, manifestDigest);
    const issueIds = manifest.issues.map((issue) => issue.id);

    expect(result.created).toBe(12);
    expect(result.alreadyPresent).toBe(0);
    expect(result.verification.summary).toEqual({ create: 0, noOp: 12, conflict: 0 });
    expect(
      await database.db.select().from(issues).where(inArray(issues.id, issueIds)),
    ).toHaveLength(12);
    expect(
      await database.db
        .select()
        .from(issueVersions)
        .where(inArray(issueVersions.issueId, issueIds)),
    ).toHaveLength(12);
    expect(
      await database.db.select().from(issueChoices).where(inArray(issueChoices.issueId, issueIds)),
    ).toHaveLength(24);
    expect(
      await database.db
        .select()
        .from(issueChoiceMedia)
        .where(eq(issueChoiceMedia.issueId, manifest.issues[0]!.id)),
    ).toHaveLength(2);
    expect(
      await database.db
        .select({ mediaMode: issueVersions.mediaMode })
        .from(issueVersions)
        .where(eq(issueVersions.issueId, manifest.issues[0]!.id)),
    ).toEqual([{ mediaMode: "OPTION_IMAGES" }]);
    expect(
      await database.db
        .select()
        .from(voteAggregates)
        .where(inArray(voteAggregates.issueId, issueIds)),
    ).toHaveLength(12);
    expect(
      await database.db
        .select()
        .from(resultSnapshots)
        .where(inArray(resultSnapshots.issueId, issueIds)),
    ).toHaveLength(12);
    const publicationEvents = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "ISSUE_PUBLISHED"));
    expect(publicationEvents).toHaveLength(12);
    expect(publicationEvents[0]?.payload).toMatchObject({
      aggregate_type: "ISSUE_VERSION",
      data: {
        pack_id: "which-19-initial-low-v1",
        manifest_digest: manifestDigest,
      },
    });

    const feed = await createIssueReadService(database.db).listGuestIssues({ limit: 20 });
    expect(feed.items).toHaveLength(12);
    expect(feed.items[0]?.id).toBe("591f2e90-996a-50c5-af46-967dd0793000");

    const reconciliation = await createGuestVoteService(database.db).reconcileIssueVersion({
      issueId: manifest.issues[0]!.id,
      issueVersion: 1,
      mode: "DRY_RUN",
    });
    expect(reconciliation.status).toBe("CONSISTENT");
    expect(reconciliation.mismatches).toEqual([]);
  });

  it("is a strict no-op on replay, including after a real Vote changes the Aggregate", async () => {
    const issue = manifest.issues[0]!;
    const voting = createGuestVoteService(database.db);
    const subject = await voting.createGuestSubject();
    const vote = await voting.submitGuestVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId: subject.anonymousSubjectId,
      issueId: issue.id,
      issueVersion: issue.version,
      choiceId: issue.choices[0].id,
    });
    expect(vote.httpStatus).toBe(201);

    const result = await publishIssueManifest(database.db, manifest, manifestDigest);
    expect(result.created).toBe(0);
    expect(result.alreadyPresent).toBe(12);
    expect(result.verification.summary).toEqual({ create: 0, noOp: 12, conflict: 0 });
    expect(
      await database.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "ISSUE_PUBLISHED")),
    ).toHaveLength(12);

    const [aggregate] = await database.db
      .select()
      .from(voteAggregates)
      .where(
        and(eq(voteAggregates.issueId, issue.id), eq(voteAggregates.issueVersion, issue.version)),
      );
    expect(aggregate).toMatchObject({ resultVersion: 2, acceptedACount: 1, displayedVoteCount: 1 });

    const reconciliation = await voting.reconcileIssueVersion({
      issueId: issue.id,
      issueVersion: issue.version,
      mode: "DRY_RUN",
    });
    expect(reconciliation.status).toBe("CONSISTENT");
  });

  it("fails closed on content drift without inserting another Issue", async () => {
    const expected = manifest.issues[0]!;
    const untouchedCount = (await database.db.select().from(issues)).length;
    await database.db
      .update(issueVersions)
      .set({ question: "운영 DB에서 변경된 질문" })
      .where(
        and(eq(issueVersions.issueId, expected.id), eq(issueVersions.version, expected.version)),
      );

    try {
      await expect(
        publishIssueManifest(database.db, manifest, manifestDigest),
      ).rejects.toBeInstanceOf(IssuePublicationConflictError);
      expect(await database.db.select().from(issues)).toHaveLength(untouchedCount);
    } finally {
      await database.db
        .update(issueVersions)
        .set({ question: expected.question })
        .where(
          and(eq(issueVersions.issueId, expected.id), eq(issueVersions.version, expected.version)),
        );
    }

    expect((await planIssuePublication(database.db, manifest, manifestDigest)).summary).toEqual({
      create: 0,
      noOp: 12,
      conflict: 0,
    });
  });
});

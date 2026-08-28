import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueChoices,
  issues,
  issueVersionSnapshots,
  issueVersions,
} from "../src/database/schema/index.js";
import {
  createContentRevisionService,
  resolveRetentionDirective,
  sealIssueVersionSnapshot,
} from "../src/modules/content-revisions/service.js";
import type { ContentRevisionError } from "../src/modules/content-revisions/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("WHICH-93 immutable content revisions", () => {
  it("seals one complete Issue snapshot and refuses a changed in-place source", async () => {
    const issueId = randomUUID();
    await database.db.insert(issues).values({ id: issueId });
    await database.db.insert(issueVersions).values({
      issueId,
      version: 1,
      question: "Immutable question?",
      context: "Original context",
      contentHash: "a".repeat(64),
      primaryCategoryCode: "TEST",
      experienceModeCode: "BINARY",
      taxonomyVersion: "v1",
      publishedAt: new Date(),
    });
    await database.db.insert(issueChoices).values([
      { issueId, issueVersion: 1, code: "A", label: "First" },
      { issueId, issueVersion: 1, code: "B", label: "Second" },
    ]);

    const sealed = await sealIssueVersionSnapshot(database.db, issueId, 1);
    expect(sealed).toMatchObject({
      issueId,
      issueVersion: 1,
      question: "Immutable question?",
      policyVersion: "issue-snapshot-v1",
      choicesSnapshot: [
        { code: "A", label: "First" },
        { code: "B", label: "Second" },
      ],
      mediaSnapshot: [],
    });
    expect(sealed.inputHash).toMatch(/^[a-f0-9]{64}$/);

    const same = await sealIssueVersionSnapshot(database.db, issueId, 1);
    expect(same.inputHash).toBe(sealed.inputHash);

    await database.db
      .update(issueVersions)
      .set({ question: "Mutated question" })
      .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, 1)));
    await expect(sealIssueVersionSnapshot(database.db, issueId, 1)).rejects.toThrow(
      "differs from the current immutable source",
    );
    const [preserved] = await database.db
      .select()
      .from(issueVersionSnapshots)
      .where(eq(issueVersionSnapshots.issueId, issueId));
    expect(preserved?.question).toBe("Immutable question?");
  });

  it("deduplicates moderation rechecks by target, version, policy, and input hash", async () => {
    const [snapshot] = await database.db.select().from(issueVersionSnapshots).limit(1);
    if (!snapshot) throw new Error("Issue snapshot fixture is missing.");
    const service = createContentRevisionService(database.db);
    const command = {
      targetType: "ISSUE_VERSION" as const,
      targetId: snapshot.issueId,
      targetVersion: snapshot.issueVersion,
      policyVersion: "moderation-policy-v1",
      inputHash: snapshot.inputHash,
      normalizedSnapshotRef: `db://issue-version-snapshots/${snapshot.issueId}/1`,
      ocrTranscriptRef: `db://ocr/${snapshot.issueId}/1`,
      reason: "CREATE" as const,
    };

    const first = await service.requestModerationRecheck(command);
    const repeated = await service.requestModerationRecheck(command);
    expect(first.created).toBe(true);
    expect(repeated).toMatchObject({ created: false, request: { id: first.request.id } });

    await expect(
      service.requestModerationRecheck({
        ...command,
        normalizedSnapshotRef: "db://different-evidence",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    } satisfies Partial<ContentRevisionError>);
  });

  it("resolves preservation directives using the documented legal precedence", () => {
    const deletion = { directiveType: "CONTENT_DELETION" as const, releasedAt: null };
    const appeal = { directiveType: "APPEAL" as const, releasedAt: null };
    const rights = { directiveType: "RIGHTS" as const, releasedAt: null };
    const legalHold = { directiveType: "LEGAL_HOLD" as const, releasedAt: null };
    expect(resolveRetentionDirective([deletion, appeal, rights, legalHold])).toBe(legalHold);
    expect(
      resolveRetentionDirective([
        { ...legalHold, releasedAt: new Date() },
        deletion,
        appeal,
        rights,
      ]),
    ).toBe(rights);
  });

  it("ships deterministic legacy backfills without inventing unavailable history", async () => {
    const migrationPath = fileURLToPath(
      new URL("../migrations/0041_legal_killraven.sql", import.meta.url),
    );
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("'LEGACY_BACKFILL'");
    expect(migration).toContain("'LEGACY_MD5_PAIR'");
    expect(migration).toContain('ON CONFLICT ("comment_id", "revision") DO NOTHING');
    expect(migration).toContain('ON CONFLICT ("issue_id", "issue_version") DO NOTHING');
  });
});

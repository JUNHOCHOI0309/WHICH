import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import Fastify from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueChoiceMedia,
  issueChoiceMediaRevisions,
  issueChoices,
  issueMediaAssets,
  issueMediaAssetVersions,
  issueMediaKnownBlockHashes,
  issueMediaLibraryUsages,
  issueMediaRuleFindings,
  issueMediaReviewDecisions,
  issueMediaRightsRequests,
  issues,
  issueVersions,
  members,
  operatorAccessGrants,
} from "../src/database/schema/index.js";
import type { IssueMediaObjectStorage } from "../src/modules/issue-media/contracts.js";
import type { IssueMediaService } from "../src/modules/issue-media/contracts.js";
import type { IssueMediaProcessingError } from "../src/modules/issue-media/image-processing.js";
import { processIssueMedia } from "../src/modules/issue-media/image-processing.js";
import type { IssueMediaError } from "../src/modules/issue-media/service.js";
import { createIssueMediaService } from "../src/modules/issue-media/service.js";
import { createIssueMediaReviewService } from "../src/modules/issue-media/review-service.js";
import { registerIssueMediaRoutes } from "../src/modules/issue-media/routes.js";
import { issueMediaStorageConfig } from "../src/modules/issue-media/storage.js";
import { createTestDatabase } from "./helpers/test-database.js";

class FakeIssueMediaStorage implements IssueMediaObjectStorage {
  readonly objects = new Map<string, Buffer>();
  readonly operations: string[] = [];

  stage(assetId: string, body: Buffer) {
    const objectKey = `issue-media/staging/${assetId}.webp`;
    this.objects.set(objectKey, body);
    this.operations.push(`stage:${assetId}`);
    return Promise.resolve({ objectKey });
  }

  publish(assetId: string, stagingObjectKey: string) {
    const body = this.objects.get(stagingObjectKey);
    if (!body) throw new Error("missing staging object");
    const objectKey = `issue-media/published/${assetId}.webp`;
    this.objects.set(objectKey, body);
    this.objects.delete(stagingObjectKey);
    this.operations.push(`publish:${assetId}`);
    return Promise.resolve({ objectKey, url: this.publicUrl(objectKey) });
  }

  quarantine(input: {
    assetId: string;
    stagingObjectKey?: string | null;
    publishedObjectKey?: string | null;
  }) {
    const sourceKey = input.publishedObjectKey ?? input.stagingObjectKey;
    const body = sourceKey ? this.objects.get(sourceKey) : undefined;
    if (!body || !sourceKey) throw new Error("missing source object");
    const objectKey = `issue-media/quarantine/${input.assetId}.webp`;
    this.objects.set(objectKey, body);
    this.objects.delete(sourceKey);
    this.operations.push(`quarantine:${input.assetId}`);
    return Promise.resolve({ objectKey });
  }

  restorePublished(assetId: string, quarantinedObjectKey: string) {
    const body = this.objects.get(quarantinedObjectKey);
    if (!body) throw new Error("missing quarantined object");
    const objectKey = `issue-media/published/${assetId}.webp`;
    this.objects.set(objectKey, body);
    this.objects.delete(quarantinedObjectKey);
    this.operations.push(`restore:${assetId}`);
    return Promise.resolve({ objectKey, url: this.publicUrl(objectKey) });
  }

  read(objectKey: string) {
    const body = this.objects.get(objectKey);
    if (!body) throw new Error("missing object");
    return Promise.resolve(body);
  }

  purge(objectKeys: Array<string | null | undefined>) {
    for (const key of objectKeys) if (key) this.objects.delete(key);
    this.operations.push("purge");
    return Promise.resolve();
  }

  publicUrl(objectKey: string) {
    return `https://media.which.test/${objectKey}`;
  }
}

async function image(
  format: "jpeg" | "png" | "webp" | "gif",
  color: { r: number; g: number; b: number },
) {
  const source = sharp({
    create: { width: 960, height: 640, channels: 3, background: color },
  });
  if (format === "jpeg") return source.withMetadata({ orientation: 6 }).jpeg().toBuffer();
  if (format === "png") return source.png().toBuffer();
  if (format === "webp") return source.webp().toBuffer();
  return source.gif().toBuffer();
}

let database: Database;
let dropDatabase: () => Promise<void>;
const operatorId = randomUUID();
const regularMemberId = randomUUID();
const issueId = randomUUID();
const choiceAId = randomUUID();
const choiceBId = randomUUID();

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  await database.db.insert(members).values([
    { id: operatorId, displayName: "Media Operator" },
    { id: regularMemberId, displayName: "Regular Member" },
  ]);
  await database.db.insert(operatorAccessGrants).values({
    memberId: operatorId,
    grantedBy: "test",
  });
  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "Which image?",
    contentHash: "d".repeat(64),
    primaryCategoryCode: "TEST",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
  });
  await database.db.insert(issueChoices).values([
    { id: choiceAId, issueId, issueVersion: 1, code: "A", label: "Blue" },
    { id: choiceBId, issueId, issueVersion: 1, code: "B", label: "Orange" },
  ]);
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("operator Issue media foundation", () => {
  it("registers a reusable Library pair and falls every linked Issue back to text on revoke", async () => {
    const libraryIssueId = randomUUID();
    const libraryChoiceAId = randomUUID();
    const libraryChoiceBId = randomUUID();
    await database.db.insert(issues).values({ id: libraryIssueId });
    await database.db.insert(issueVersions).values({
      issueId: libraryIssueId,
      version: 1,
      question: "Which reusable image pair?",
      contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      primaryCategoryCode: "LIFE",
      experienceModeCode: "BINARY",
      taxonomyVersion: "v1",
    });
    await database.db.insert(issueChoices).values([
      {
        id: libraryChoiceAId,
        issueId: libraryIssueId,
        issueVersion: 1,
        code: "A",
        label: "Reusable A",
      },
      {
        id: libraryChoiceBId,
        issueId: libraryIssueId,
        issueVersion: 1,
        code: "B",
        label: "Reusable B",
      },
    ]);
    const storage = new FakeIssueMediaStorage();
    const service = createIssueMediaService(database.db, storage);
    const staged = await Promise.all([
      service.stageAsset({
        memberId: operatorId,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "Reusable A image with verified commercial and redistribution rights.",
        declaredMimeType: "image/png",
        bytes: await image("png", { r: 2, g: 130, b: 170 }),
      }),
      service.stageAsset({
        memberId: operatorId,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "Reusable B image with verified commercial and redistribution rights.",
        declaredMimeType: "image/png",
        bytes: await image("png", { r: 245, g: 108, b: 64 }),
      }),
    ]);
    const published = await Promise.all(
      staged.map((candidate) =>
        service.approveAndPublish({ memberId: operatorId, assetId: candidate!.id }),
      ),
    );
    const pair = await service.registerLibraryPair({
      memberId: operatorId,
      pair: {
        title: "Reusable A/B pair",
        categoryCode: "LIFE",
        topics: ["daily", "choice"],
        assets: published.map((candidate, index) => ({
          side: index === 0 ? ("A" as const) : ("B" as const),
          mediaAssetId: candidate!.id,
          altText: index === 0 ? "Cyan reusable scene" : "Orange reusable scene",
          cropMode: "COVER" as const,
          sourceUrl: "https://source.example/library/" + String(index),
          authorName: "Library Author",
          licenseName: "Commercial reusable license",
          licenseVersion: "2026-08",
          acquiredAt: new Date().toISOString(),
          commercialAllowed: true,
          derivativeAllowed: true,
          redistributionAllowed: true,
          evidenceReference: "https://evidence.example/library/" + String(index),
        })),
      },
    });
    expect(pair?.assets).toHaveLength(2);

    await service.attachChoice({
      memberId: operatorId,
      issueId: libraryIssueId,
      issueVersion: 1,
      choiceId: libraryChoiceAId,
      assetId: published[0]!.id,
      altText: "Cyan reusable scene",
      cropMode: "COVER",
      displayPosition: 0,
    });
    await service.attachChoice({
      memberId: operatorId,
      issueId: libraryIssueId,
      issueVersion: 1,
      choiceId: libraryChoiceBId,
      assetId: published[1]!.id,
      altText: "Orange reusable scene",
      cropMode: "COVER",
      displayPosition: 1,
    });
    await database.db.insert(issueMediaLibraryUsages).values(
      pair!.assets.map((candidate) => ({
        pairId: pair!.id,
        libraryAssetId: candidate.id,
        issueId: libraryIssueId,
        issueVersion: 1,
        choiceId: candidate.side === "A" ? libraryChoiceAId : libraryChoiceBId,
        side: candidate.side,
        selectedByMemberId: operatorId,
      })),
    );

    const revoked = await service.revokeLibraryPair({
      memberId: operatorId,
      pairId: pair!.id,
      reason: "Rights owner requested immediate withdrawal from the reusable Library.",
    });
    expect(revoked).toEqual({ pairId: pair!.id, fallbackIssueCount: 1 });
    const [links, usages, version] = await Promise.all([
      database.db
        .select()
        .from(issueChoiceMedia)
        .where(eq(issueChoiceMedia.issueId, libraryIssueId)),
      database.db
        .select()
        .from(issueMediaLibraryUsages)
        .where(eq(issueMediaLibraryUsages.pairId, pair!.id)),
      database.db
        .select({ mediaMode: issueVersions.mediaMode })
        .from(issueVersions)
        .where(eq(issueVersions.issueId, libraryIssueId)),
    ]);
    expect(links).toEqual([]);
    expect(usages.every((usage) => usage.status === "TEXT_FALLBACK")).toBe(true);
    expect(version).toEqual([{ mediaMode: "TEXT_ONLY" }]);
    expect(
      storage.operations.filter((operation) => operation.startsWith("quarantine:")),
    ).toHaveLength(2);
  });

  it("stages Member submission media privately without requiring operator access", async () => {
    const storage = new FakeIssueMediaStorage();
    const service = createIssueMediaService(database.db, storage);
    const asset = await service.stageMemberAsset({
      memberId: regularMemberId,
      rightsAttestation: "I own this test image and allow editorial review and publication.",
      declaredMimeType: "image/png",
      bytes: await image("png", { r: 8, g: 120, b: 160 }),
    });

    expect(asset).toMatchObject({
      sourceType: "MEMBER_SUBMISSION",
      processingState: "READY",
      moderationState: "PENDING",
      storageState: "STAGED",
      publishedUrl: null,
    });
    expect(storage.operations).toContain(`stage:${asset.id}`);
    const findings = await database.db
      .select({ code: issueMediaRuleFindings.code })
      .from(issueMediaRuleFindings)
      .where(eq(issueMediaRuleFindings.mediaAssetId, asset.id));
    expect(findings).toEqual(
      expect.arrayContaining([
        { code: "MEDIA_NORMALIZED_WEBP_READY" },
        { code: "MEDIA_HASHES_COMPUTED" },
        { code: "MEDIA_QR_SCAN_INCOMPLETE" },
        { code: "MEDIA_OCR_SCAN_INCOMPLETE" },
        { code: "MEDIA_ROUTE_REVIEW_REQUIRED" },
      ]),
    );
  });

  it("rejects a verified exact known-block hash before staging", async () => {
    const storage = new FakeIssueMediaStorage();
    const service = createIssueMediaService(database.db, storage);
    const bytes = await image("png", { r: 190, g: 1, b: 2 });
    const processed = await processIssueMedia(bytes, "image/png");
    await database.db.insert(issueMediaKnownBlockHashes).values({
      sha256: processed.sha256,
      policyVersion: "known-block-test-v1",
      reasonCode: "VERIFIED_TEST_BLOCK",
    });
    await expect(
      service.stageMemberAsset({
        memberId: regularMemberId,
        rightsAttestation: "I own this blocked test image and request an upload review.",
        declaredMimeType: "image/png",
        bytes,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_KNOWN_BLOCK" });
    expect(storage.operations).toEqual([]);
  });

  it("fails closed when R2 media storage is missing, shared, or publicly misconfigured", () => {
    const base = {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_ISSUE_MEDIA_STAGING_BUCKET: "which-media-staging",
      R2_ISSUE_MEDIA_PUBLISHED_BUCKET: "which-media-published",
      R2_ISSUE_MEDIA_PUBLIC_BASE_URL: "https://media.which.test/",
    };

    expect(issueMediaStorageConfig({})).toBeNull();
    expect(
      issueMediaStorageConfig({
        ...base,
        R2_ISSUE_MEDIA_PUBLISHED_BUCKET: base.R2_ISSUE_MEDIA_STAGING_BUCKET,
      }),
    ).toBeNull();
    expect(
      issueMediaStorageConfig({
        ...base,
        R2_ISSUE_MEDIA_PUBLIC_BASE_URL: "http://media.which.test",
      }),
    ).toBeNull();
    expect(issueMediaStorageConfig(base)).toMatchObject({
      stagingBucket: "which-media-staging",
      publishedBucket: "which-media-published",
      publicBaseUrl: "https://media.which.test",
    });
  });

  it("rejects anonymous, external URL, and GIF upload contracts before storage", async () => {
    const app = Fastify({ logger: false });
    const stageAsset = vi.fn(() =>
      Promise.resolve({
        id: randomUUID(),
        sourceType: "OPERATOR_UPLOAD" as const,
        sha256: "a".repeat(64),
        perceptualHash: "b".repeat(16),
        input: { mimeType: "image/png" as const, byteSize: 5, width: 1, height: 1 },
        output: { mimeType: "image/webp" as const, byteSize: 5, width: 1, height: 1 },
        processingState: "READY" as const,
        moderationState: "PENDING" as const,
        storageState: "STAGED" as const,
        rightsState: "ASSERTED" as const,
        publishedUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const service = { stageAsset } as unknown as IssueMediaService;
    const identity = {
      getSession: vi.fn((token: string) =>
        Promise.resolve(token === "operator-token" ? { member: { id: operatorId } } : null),
      ),
    };
    await registerIssueMediaRoutes(app, service, identity as never, "test-internal-secret");
    const basePayload = {
      sourceType: "OPERATOR_UPLOAD",
      rightsAttestation: "I confirm documented publication rights for this test image.",
      declaredMimeType: "image/png",
      contentBase64: "aGVsbG8=",
    };
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/media-assets",
      payload: basePayload,
    });
    expect(anonymous.statusCode).toBe(401);
    const headers = {
      authorization: "Bearer operator-token",
      "x-internal-auth-secret": "test-internal-secret",
    };
    const external = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/media-assets",
      headers,
      payload: { ...basePayload, sourceUrl: "https://example.com/image.png" },
    });
    expect(external.statusCode).toBe(400);
    const gif = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/media-assets",
      headers,
      payload: { ...basePayload, declaredMimeType: "image/gif" },
    });
    expect(gif.statusCode).toBe(400);
    expect(stageAsset).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts Member media through session auth without exposing the internal secret", async () => {
    const app = Fastify({ logger: false });
    const staged = {
      id: randomUUID(),
      sourceType: "MEMBER_SUBMISSION" as const,
      sha256: "c".repeat(64),
      perceptualHash: "d".repeat(16),
      input: { mimeType: "image/png" as const, byteSize: 5, width: 1, height: 1 },
      output: { mimeType: "image/webp" as const, byteSize: 5, width: 1, height: 1 },
      processingState: "READY" as const,
      moderationState: "PENDING" as const,
      storageState: "STAGED" as const,
      rightsState: "ASSERTED" as const,
      publishedUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const stageMemberAsset = vi.fn(() => Promise.resolve(staged));
    const service = { stageMemberAsset } as unknown as IssueMediaService;
    const consumeSession = vi.fn(() => Promise.resolve({ objectKey: "private/source" }));
    const uploadGate = {
      readAccess: vi.fn(),
      acceptConsent: vi.fn(),
      listPilotMembers: vi.fn(),
      decidePilotCapability: vi.fn(),
      createSession: vi.fn(),
      consumeSession,
    };
    const identity = {
      getSession: vi.fn((token: string) =>
        Promise.resolve(token === "member-token" ? { member: { id: regularMemberId } } : null),
      ),
    };
    await registerIssueMediaRoutes(
      app,
      service,
      identity as never,
      "test-internal-secret",
      uploadGate,
    );

    const uploadSessionId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/v1/member/issue-submission-media",
      headers: { authorization: "Bearer member-token" },
      payload: {
        uploadSessionId,
        uploadSessionToken: "x".repeat(43),
        rightsAttestation: "I own this image and allow editorial review and publication.",
        declaredMimeType: "image/png",
        contentBase64: "aGVsbG8=",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ asset: { sourceType: "MEMBER_SUBMISSION" } });
    expect(stageMemberAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: regularMemberId,
        uploadSessionId,
        bytes: Buffer.from("hello"),
      }),
    );
    expect(consumeSession).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: regularMemberId, byteSize: 5 }),
    );
    await app.close();
  });

  it("normalizes allowed signatures to metadata-free WebP and rejects GIF or MIME spoofing", async () => {
    const jpeg = await image("jpeg", { r: 0, g: 120, b: 220 });
    const processed = await processIssueMedia(jpeg, "image/jpeg");
    const metadata = await sharp(processed.body).metadata();
    expect(processed).toMatchObject({
      input: { mimeType: "image/jpeg", width: 960, height: 640 },
      output: { mimeType: "image/webp", width: 640, height: 960 },
    });
    expect(processed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(processed.perceptualHash).toMatch(/^[a-f0-9]{16}$/);
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();

    await expect(processIssueMedia(jpeg, "image/png")).rejects.toMatchObject({
      code: "MEDIA_MIME_MISMATCH",
    } satisfies Partial<IssueMediaProcessingError>);
    await expect(
      processIssueMedia(await image("gif", { r: 20, g: 20, b: 20 }), "image/webp"),
    ).rejects.toMatchObject({ code: "MEDIA_FORMAT_UNSUPPORTED" });
  });

  it("stages privately, publishes, links exactly one asset per choice, and rolls back to text", async () => {
    const storage = new FakeIssueMediaStorage();
    const service = createIssueMediaService(database.db, storage);
    const stage = async (format: "jpeg" | "png" | "webp", color: [number, number, number]) =>
      service.stageAsset({
        memberId: operatorId,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "I confirm WHICH has documented rights to publish this test image.",
        declaredMimeType: `image/${format}`,
        bytes: await image(format, { r: color[0], g: color[1], b: color[2] }),
      });

    expect(
      await service.stageAsset({
        memberId: regularMemberId,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "I confirm WHICH has documented rights to publish this test image.",
        declaredMimeType: "image/png",
        bytes: await image("png", { r: 1, g: 2, b: 3 }),
      }),
    ).toBeNull();

    const stagedA = await stage("jpeg", [10, 120, 220]);
    const stagedB = await stage("png", [240, 110, 20]);
    expect(stagedA).toMatchObject({
      storageState: "STAGED",
      moderationState: "PENDING",
      rightsState: "ASSERTED",
      publishedUrl: null,
    });
    expect(storage.objects.has(`issue-media/staging/${stagedA!.id}.webp`)).toBe(true);
    const normalizedBody = storage.objects.get(`issue-media/staging/${stagedA!.id}.webp`);
    if (!normalizedBody) throw new Error("normalized staging object missing");
    const normalizedMetadata = await sharp(normalizedBody).metadata();
    expect(normalizedMetadata).toMatchObject({ format: "webp" });
    expect(normalizedMetadata.exif).toBeUndefined();
    const [assetVersion] = await database.db
      .select()
      .from(issueMediaAssetVersions)
      .where(eq(issueMediaAssetVersions.assetId, stagedA!.id));
    expect(assetVersion).toMatchObject({
      version: 1,
      sourceType: "OPERATOR_UPLOAD",
      sha256: stagedA!.sha256,
      normalizedObjectRef: `issue-media://asset/${stagedA!.id}/version/1`,
    });

    await expect(stage("jpeg", [10, 120, 220])).rejects.toMatchObject({
      code: "MEDIA_DUPLICATE",
    } satisfies Partial<IssueMediaError>);

    const publishedA = await service.approveAndPublish({
      memberId: operatorId,
      assetId: stagedA!.id,
    });
    const publishedB = await service.approveAndPublish({
      memberId: operatorId,
      assetId: stagedB!.id,
    });
    expect(publishedA).toMatchObject({ storageState: "PUBLISHED", moderationState: "APPROVED" });
    expect(publishedA?.publishedUrl).toBe(
      `https://media.which.test/issue-media/published/${stagedA!.id}.webp`,
    );

    await service.attachChoice({
      memberId: operatorId,
      issueId,
      issueVersion: 1,
      choiceId: choiceAId,
      assetId: publishedA!.id,
      altText: "Blue comparison image",
      cropMode: "COVER",
      displayPosition: 0,
    });
    await service.attachChoice({
      memberId: operatorId,
      issueId,
      issueVersion: 1,
      choiceId: choiceBId,
      assetId: publishedB!.id,
      altText: "Orange comparison image",
      cropMode: "COVER",
      displayPosition: 1,
    });
    const [versionWithImages] = await database.db
      .select()
      .from(issueVersions)
      .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, 1)));
    expect(versionWithImages?.mediaMode).toBe("OPTION_IMAGES");
    expect(
      await database.db
        .select()
        .from(issueChoiceMedia)
        .where(eq(issueChoiceMedia.issueId, issueId)),
    ).toHaveLength(2);

    const replacement = await stage("webp", [90, 30, 180]);
    await service.approveAndPublish({ memberId: operatorId, assetId: replacement!.id });
    const replaced = await service.attachChoice({
      memberId: operatorId,
      issueId,
      issueVersion: 1,
      choiceId: choiceAId,
      assetId: replacement!.id,
      altText: "Replacement violet image",
      cropMode: "CONTAIN",
      displayPosition: 0,
    });
    expect(replaced?.replacedAssetId).toBe(stagedA!.id);
    const choiceARevisions = await database.db
      .select({
        revision: issueChoiceMediaRevisions.revision,
        operation: issueChoiceMediaRevisions.operation,
        assetId: issueChoiceMediaRevisions.mediaAssetId,
        altText: issueChoiceMediaRevisions.altText,
      })
      .from(issueChoiceMediaRevisions)
      .where(eq(issueChoiceMediaRevisions.choiceId, choiceAId))
      .orderBy(asc(issueChoiceMediaRevisions.revision));
    expect(choiceARevisions).toEqual([
      {
        revision: 1,
        operation: "ATTACHED",
        assetId: stagedA!.id,
        altText: "Blue comparison image",
      },
      {
        revision: 2,
        operation: "REPLACED",
        assetId: replacement!.id,
        altText: "Replacement violet image",
      },
    ]);
    const [oldAsset] = await database.db
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, stagedA!.id));
    expect(oldAsset).toMatchObject({ storageState: "QUARANTINED", moderationState: "REVOKED" });

    expect(
      await service.quarantineIssue({
        memberId: operatorId,
        issueId,
        reason: "ISSUE_BLINDED",
      }),
    ).toEqual({ quarantined: 2 });

    expect(
      await service.quarantineIssue({
        memberId: operatorId,
        issueId,
        reason: "RIGHTS_CHALLENGED",
      }),
    ).toEqual({ quarantined: 2 });
    const [quarantined] = await database.db
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, replacement!.id));
    expect(quarantined).toMatchObject({
      storageState: "QUARANTINED",
      rightsState: "CHALLENGED",
    });
    const purged = await service.purgeAsset({
      memberId: operatorId,
      assetId: replacement!.id,
      reason: "RIGHTS_WITHDRAWN",
    });
    expect(purged).toMatchObject({ storageState: "PURGED", rightsState: "WITHDRAWN" });
    expect(
      await service.purgeIssue({ memberId: operatorId, issueId, reason: "ISSUE_DELETED" }),
    ).toEqual({ purged: 1 });
    const [textFallback] = await database.db
      .select()
      .from(issueVersions)
      .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, 1)));
    expect(textFallback?.mediaMode).toBe("TEXT_ONLY");

    expect(
      await service.detachChoice({
        memberId: operatorId,
        issueId,
        issueVersion: 1,
        choiceId: choiceBId,
      }),
    ).toEqual({ detached: false });
  }, 10_000);

  it("purges old unlinked staging objects and prevents in-place edits after publication", async () => {
    const storage = new FakeIssueMediaStorage();
    const service = createIssueMediaService(database.db, storage);
    const staged = await service.stageAsset({
      memberId: operatorId,
      sourceType: "OPERATOR_UPLOAD",
      rightsAttestation: "I confirm WHICH has documented rights to publish this orphan image.",
      declaredMimeType: "image/png",
      bytes: await image("png", { r: 40, g: 210, b: 70 }),
    });
    await database.db
      .update(issueMediaAssets)
      .set({ createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
      .where(eq(issueMediaAssets.id, staged!.id));
    expect(await service.purgeOrphans({ memberId: operatorId, olderThanHours: 24 })).toEqual({
      purged: 1,
    });
    const [orphan] = await database.db
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, staged!.id));
    expect(orphan?.storageState).toBe("PURGED");

    const lockedAsset = await service.stageAsset({
      memberId: operatorId,
      sourceType: "OPERATOR_UPLOAD",
      rightsAttestation: "I confirm WHICH has documented rights to publish this locked test image.",
      declaredMimeType: "image/png",
      bytes: await image("png", { r: 200, g: 200, b: 20 }),
    });
    await service.approveAndPublish({ memberId: operatorId, assetId: lockedAsset!.id });
    await database.db
      .update(issueVersions)
      .set({ publishedAt: new Date(), lockedAt: new Date() })
      .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, 1)));
    await expect(
      service.attachChoice({
        memberId: operatorId,
        issueId,
        issueVersion: 1,
        choiceId: choiceBId,
        assetId: lockedAsset!.id,
        altText: "Cannot attach after publication",
        cropMode: "COVER",
        displayPosition: 1,
      }),
    ).rejects.toMatchObject({ code: "ISSUE_VERSION_LOCKED" });

    const [version] = await database.db
      .select()
      .from(issueVersions)
      .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, 1)));
    expect(version).toMatchObject({ formatMode: "VS", mediaMode: "TEXT_ONLY" });
  });

  it("keeps review decisions append-only and supports emergency hide, restore, and rights cases", async () => {
    const storage = new FakeIssueMediaStorage();
    const foundation = createIssueMediaService(database.db, storage);
    const review = createIssueMediaReviewService(database.db, storage, foundation);
    const staged = await foundation.stageAsset({
      memberId: operatorId,
      sourceType: "OPERATOR_UPLOAD",
      rightsAttestation:
        "The operator verified a reusable licensed source for this review fixture.",
      declaredMimeType: "image/png",
      bytes: await image("png", { r: 11, g: 77, b: 143 }),
      requestId: "review-stage",
    });
    if (!staged) throw new Error("staging failed");

    expect(
      await review.readAssets({ memberId: regularMemberId, limit: 10, requestId: "denied" }),
    ).toBeNull();
    const pending = await review.readAssets({
      memberId: operatorId,
      status: "PENDING",
      limit: 10,
      requestId: "list-pending",
    });
    expect(pending?.items.find((item) => item.id === staged.id)?.publishedUrl).toBeNull();
    expect(pending?.items.find((item) => item.id === staged.id)?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MEDIA_NORMALIZED_WEBP_READY", severity: "INFO" }),
        expect.objectContaining({ stage: "ROUTING" }),
      ]),
    );
    expect(await review.readAssetContent({ memberId: operatorId, assetId: staged.id })).toEqual(
      storage.objects.get(`issue-media/staging/${staged.id}.webp`),
    );

    const approved = await review.decideAsset({
      memberId: operatorId,
      assetId: staged.id,
      status: "APPROVED",
      reasonCode: "LICENSE_VERIFIED",
      rationale: "Source rights and visual safety were verified by the operator.",
      policyVersion: "issue-media-review-v1",
      requestId: "approve-request",
    });
    expect(approved).toMatchObject({ effectiveStatus: "APPROVED" });
    expect(approved?.publishedUrl).toContain(`/published/${staged.id}.webp`);

    expect(
      await review.decideAsset({
        memberId: operatorId,
        assetId: staged.id,
        status: "HIDDEN",
        reasonCode: "EMERGENCY_BLOCK",
        rationale: "Emergency operator block while the reported context is investigated.",
        policyVersion: "issue-media-review-v1",
        requestId: "hide-request",
      }),
    ).toMatchObject({ effectiveStatus: "HIDDEN", publishedUrl: null });
    expect(
      await review.decideAsset({
        memberId: operatorId,
        assetId: staged.id,
        status: "RESTORED",
        reasonCode: "EMERGENCY_CLEARED",
        rationale: "The emergency review completed and no blocking condition remains.",
        policyVersion: "issue-media-review-v1",
        requestId: "restore-request",
      }),
    ).toMatchObject({ effectiveStatus: "APPROVED" });

    const rights = await review.createRightsRequest({
      memberId: operatorId,
      requestType: "COPYRIGHT",
      assetId: staged.id,
      requesterReference: "case@example.test",
      details: "The claimant requested a copyright provenance review for this exact asset.",
      policyVersion: "issue-media-review-v1",
      requestId: "rights-request",
    });
    expect(rights).toMatchObject({ status: "OPEN", requestType: "COPYRIGHT" });
    const [hidden] = await database.db
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, staged.id));
    expect(hidden).toMatchObject({ storageState: "QUARANTINED", rightsState: "CHALLENGED" });
    expect(
      await review.resolveRightsRequest({
        memberId: operatorId,
        requestIdValue: rights!.id,
        status: "DISMISSED",
        resolution: "The supplied license record was validated and the request was dismissed.",
        requestId: "rights-resolve",
      }),
    ).toMatchObject({ status: "DISMISSED" });

    const decisions = await database.db
      .select()
      .from(issueMediaReviewDecisions)
      .where(eq(issueMediaReviewDecisions.mediaAssetId, staged.id));
    expect(decisions.map((decision) => decision.status)).toEqual([
      "APPROVED",
      "HIDDEN",
      "RESTORED",
      "HIDDEN",
    ]);
    expect(
      await database.db
        .select()
        .from(issueMediaRightsRequests)
        .where(eq(issueMediaRightsRequests.id, rights!.id)),
    ).toHaveLength(1);
  });
});

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { IssueMediaObjectStorage } from "./contracts.js";

export type IssueMediaStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  stagingBucket: string;
  publishedBucket: string;
  publicBaseUrl: string;
};

export function issueMediaStorageConfig(environment: NodeJS.ProcessEnv = process.env) {
  const value = (name: string) => environment[name]?.trim() || undefined;
  const accountId = value("R2_ACCOUNT_ID");
  const accessKeyId = value("R2_ACCESS_KEY_ID");
  const secretAccessKey = value("R2_SECRET_ACCESS_KEY");
  const stagingBucket = value("R2_ISSUE_MEDIA_STAGING_BUCKET");
  const publishedBucket = value("R2_ISSUE_MEDIA_PUBLISHED_BUCKET");
  const configuredPublicBaseUrl = value("R2_ISSUE_MEDIA_PUBLIC_BASE_URL");
  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !stagingBucket ||
    !publishedBucket ||
    !configuredPublicBaseUrl ||
    stagingBucket === publishedBucket
  ) {
    return null;
  }
  try {
    const publicBaseUrl = new URL(configuredPublicBaseUrl);
    if (publicBaseUrl.protocol !== "https:" || publicBaseUrl.username || publicBaseUrl.password) {
      return null;
    }
    publicBaseUrl.search = "";
    publicBaseUrl.hash = "";
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      stagingBucket,
      publishedBucket,
      publicBaseUrl: publicBaseUrl.toString().replace(/\/$/, ""),
    } satisfies IssueMediaStorageConfig;
  } catch {
    return null;
  }
}

export function createR2IssueMediaStorage(
  config: IssueMediaStorageConfig,
): IssueMediaObjectStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const copy = async (sourceBucket: string, sourceKey: string, bucket: string, key: string) => {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${sourceBucket}/${encodeURIComponent(sourceKey).replaceAll("%2F", "/")}`,
        ContentType: "image/webp",
        MetadataDirective: "REPLACE",
        CacheControl:
          bucket === config.publishedBucket ? "public, max-age=31536000, immutable" : "no-store",
      }),
    );
  };
  const remove = async (bucket: string, key: string | null | undefined) => {
    if (!key) return;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  };

  return {
    async stage(assetId, body) {
      const objectKey = `issue-media/staging/${assetId}.webp`;
      await client.send(
        new PutObjectCommand({
          Bucket: config.stagingBucket,
          Key: objectKey,
          Body: body,
          ContentType: "image/webp",
          CacheControl: "no-store",
        }),
      );
      return { objectKey };
    },
    async publish(assetId, stagingObjectKey) {
      const objectKey = `issue-media/published/${assetId}.webp`;
      await copy(config.stagingBucket, stagingObjectKey, config.publishedBucket, objectKey);
      await remove(config.stagingBucket, stagingObjectKey);
      return { objectKey, url: `${config.publicBaseUrl}/${objectKey}` };
    },
    async quarantine(input) {
      const objectKey = `issue-media/quarantine/${input.assetId}.webp`;
      if (input.publishedObjectKey) {
        await copy(
          config.publishedBucket,
          input.publishedObjectKey,
          config.stagingBucket,
          objectKey,
        );
        await remove(config.publishedBucket, input.publishedObjectKey);
      } else if (input.stagingObjectKey) {
        await copy(config.stagingBucket, input.stagingObjectKey, config.stagingBucket, objectKey);
        await remove(config.stagingBucket, input.stagingObjectKey);
      } else {
        throw new Error("The media asset has no object that can be quarantined.");
      }
      return { objectKey };
    },
    async restorePublished(assetId, quarantinedObjectKey) {
      const objectKey = `issue-media/published/${assetId}.webp`;
      await copy(config.stagingBucket, quarantinedObjectKey, config.publishedBucket, objectKey);
      await remove(config.stagingBucket, quarantinedObjectKey);
      return { objectKey };
    },
    async read(objectKey) {
      const bucket = objectKey.startsWith("issue-media/published/")
        ? config.publishedBucket
        : config.stagingBucket;
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      if (!response.Body) throw new Error("The Issue media object body is unavailable.");
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async exists(objectKey) {
      const bucket = objectKey.startsWith("issue-media/published/")
        ? config.publishedBucket
        : config.stagingBucket;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        return true;
      } catch (error) {
        const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (statusCode === 404) return false;
        throw error;
      }
    },
    async purge(objectKeys) {
      await Promise.all(
        objectKeys.map((key) => {
          if (!key) return Promise.resolve();
          const bucket = key.startsWith("issue-media/published/")
            ? config.publishedBucket
            : config.stagingBucket;
          return remove(bucket, key);
        }),
      );
    },
    publicUrl(objectKey) {
      return `${config.publicBaseUrl}/${objectKey}`;
    },
  };
}

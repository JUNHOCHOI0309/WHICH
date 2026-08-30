import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;

export class AvatarStorageError extends Error {
  constructor(
    public readonly code:
      | "AVATAR_FORMAT_UNSUPPORTED"
      | "AVATAR_TOO_LARGE"
      | "AVATAR_PROCESSING_FAILED"
      | "AVATAR_STORAGE_UNAVAILABLE"
      | "AVATAR_SOURCE_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "AvatarStorageError";
  }
}

type AvatarStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

function environmentValue(name: string) {
  return process.env[name]?.trim() || undefined;
}

export function avatarStorageConfig(): AvatarStorageConfig | null {
  const accountId = environmentValue("R2_ACCOUNT_ID");
  const accessKeyId = environmentValue("R2_ACCESS_KEY_ID");
  const secretAccessKey = environmentValue("R2_SECRET_ACCESS_KEY");
  const bucket = environmentValue("R2_BUCKET_NAME");
  const configuredBaseUrl = environmentValue("R2_PUBLIC_BASE_URL");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !configuredBaseUrl) return null;

  try {
    const publicBaseUrl = new URL(configuredBaseUrl);
    if (publicBaseUrl.protocol !== "https:" || publicBaseUrl.username || publicBaseUrl.password) {
      return null;
    }
    publicBaseUrl.search = "";
    publicBaseUrl.hash = "";
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicBaseUrl: publicBaseUrl.toString().replace(/\/$/, ""),
    };
  } catch {
    return null;
  }
}

function storageClient(config: AvatarStorageConfig) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function transformAvatarToWebp(input: Buffer) {
  if (input.byteLength === 0 || input.byteLength > MAX_AVATAR_BYTES) {
    throw new AvatarStorageError(
      "AVATAR_TOO_LARGE",
      "프로필 이미지는 5MB 이하만 사용할 수 있습니다.",
    );
  }

  try {
    const source = sharp(input, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await source.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new AvatarStorageError(
        "AVATAR_FORMAT_UNSUPPORTED",
        "JPG 또는 PNG 이미지만 업로드할 수 있습니다.",
      );
    }
    return await source
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 82, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof AvatarStorageError) throw error;
    throw new AvatarStorageError(
      "AVATAR_PROCESSING_FAILED",
      "이미지를 처리할 수 없습니다. 다른 JPG 또는 PNG 파일을 선택해 주세요.",
    );
  }
}

export async function storeAvatar(memberId: string, input: Buffer) {
  const config = avatarStorageConfig();
  if (!config) {
    throw new AvatarStorageError(
      "AVATAR_STORAGE_UNAVAILABLE",
      "프로필 이미지 저장소 설정이 아직 완료되지 않았습니다.",
    );
  }
  const body = await transformAvatarToWebp(input);
  const objectKey = `avatars/${memberId}/${randomUUID()}.webp`;
  await storageClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { objectKey, url: `${config.publicBaseUrl}/${objectKey}` };
}

export async function deleteStoredAvatar(objectKey: string | null | undefined) {
  if (!objectKey || !/^avatars\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.webp$/.test(objectKey)) return;
  const config = avatarStorageConfig();
  if (!config) return;
  await storageClient(config).send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
  );
}

const SOCIAL_IMAGE_HOSTS: Record<"GOOGLE" | "X" | "NAVER" | "KAKAO" | "TIKTOK", string[]> = {
  GOOGLE: ["googleusercontent.com", "ggpht.com"],
  X: ["twimg.com"],
  NAVER: ["pstatic.net", "naver.net"],
  KAKAO: ["kakaocdn.net", "kakao.com"],
  TIKTOK: ["tiktokcdn.com", "tiktokcdn-us.com"],
};

function hostMatches(hostname: string, allowedSuffix: string) {
  return hostname === allowedSuffix || hostname.endsWith(`.${allowedSuffix}`);
}

export async function readSocialAvatar(
  provider: keyof typeof SOCIAL_IMAGE_HOSTS,
  sourceUrl: string,
) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new AvatarStorageError(
      "AVATAR_SOURCE_REJECTED",
      "소셜 프로필 이미지 주소가 잘못되었습니다.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !SOCIAL_IMAGE_HOSTS[provider].some((suffix) => hostMatches(url.hostname, suffix))
  ) {
    throw new AvatarStorageError("AVATAR_SOURCE_REJECTED", "허용되지 않은 이미지 제공처입니다.");
  }

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
  });
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (!response.ok || (contentLength > 0 && contentLength > MAX_AVATAR_BYTES)) {
    throw new AvatarStorageError(
      "AVATAR_SOURCE_REJECTED",
      "소셜 프로필 이미지를 가져오지 못했습니다.",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new AvatarStorageError("AVATAR_TOO_LARGE", "소셜 프로필 이미지가 너무 큽니다.");
  }
  return bytes;
}

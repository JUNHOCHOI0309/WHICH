import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  AvatarStorageError,
  readSocialAvatar,
  transformAvatarToWebp,
} from "@/lib/server/avatar-storage";

describe("avatar image normalization", () => {
  it("converts an uploaded image to a metadata-free 512px WebP", async () => {
    const png = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#18bfd0" },
    })
      .png()
      .toBuffer();

    const output = await transformAvatarToWebp(png);
    const metadata = await sharp(output).metadata();

    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(output.byteLength).toBeLessThan(png.byteLength);
  });

  it("rejects invalid and oversized input before storage", async () => {
    await expect(transformAvatarToWebp(Buffer.from("not an image"))).rejects.toMatchObject({
      code: "AVATAR_PROCESSING_FAILED",
    } satisfies Partial<AvatarStorageError>);
    await expect(transformAvatarToWebp(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "AVATAR_TOO_LARGE",
    } satisfies Partial<AvatarStorageError>);
  });

  it("rejects social image hosts outside the Provider allowlist", async () => {
    await expect(
      readSocialAvatar("GOOGLE", "https://example.com/avatar.png"),
    ).rejects.toMatchObject({
      code: "AVATAR_SOURCE_REJECTED",
    } satisfies Partial<AvatarStorageError>);
  });
});

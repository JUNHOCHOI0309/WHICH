import { createHash } from "node:crypto";

import sharp from "sharp";

import type { IssueMediaInputMimeType } from "./contracts.js";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_EDGE = 1600;
const MAX_PROCESSING_MILLISECONDS = 10_000;
const MAX_CONCURRENT_PROCESSING = 2;
let activeProcessing = 0;

export class IssueMediaProcessingError extends Error {
  constructor(
    public readonly code:
      | "MEDIA_EMPTY"
      | "MEDIA_TOO_LARGE"
      | "MEDIA_FORMAT_UNSUPPORTED"
      | "MEDIA_MIME_MISMATCH"
      | "MEDIA_PROCESSING_BUSY"
      | "MEDIA_PROCESSING_TIMEOUT"
      | "MEDIA_PROCESSING_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "IssueMediaProcessingError";
  }
}

const formatMime: Record<string, IssueMediaInputMimeType | undefined> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function perceptualDifferenceHash(webp: Buffer) {
  const pixels = await sharp(webp).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      hash <<= 1n;
      if (pixels[row * 9 + column]! > pixels[row * 9 + column + 1]!) hash |= 1n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export async function processIssueMedia(input: Buffer, declaredMimeType: IssueMediaInputMimeType) {
  if (input.byteLength === 0) {
    throw new IssueMediaProcessingError("MEDIA_EMPTY", "An image file is required.");
  }
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw new IssueMediaProcessingError("MEDIA_TOO_LARGE", "Issue media must not exceed 10MB.");
  }

  if (activeProcessing >= MAX_CONCURRENT_PROCESSING) {
    throw new IssueMediaProcessingError(
      "MEDIA_PROCESSING_BUSY",
      "The image processing queue is at capacity. Try again later.",
    );
  }
  activeProcessing += 1;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      processBoundedIssueMedia(input, declaredMimeType),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new IssueMediaProcessingError(
                "MEDIA_PROCESSING_TIMEOUT",
                "The image could not be processed within the safety time limit.",
              ),
            ),
          MAX_PROCESSING_MILLISECONDS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    activeProcessing -= 1;
  }
}

async function processBoundedIssueMedia(input: Buffer, declaredMimeType: IssueMediaInputMimeType) {
  try {
    const source = sharp(input, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS });
    const inputMetadata = await source.metadata();
    const detectedMimeType = inputMetadata.format ? formatMime[inputMetadata.format] : undefined;
    if (!detectedMimeType || !inputMetadata.width || !inputMetadata.height) {
      throw new IssueMediaProcessingError(
        "MEDIA_FORMAT_UNSUPPORTED",
        "Only JPEG, PNG, and WebP images are supported.",
      );
    }
    if (detectedMimeType !== declaredMimeType) {
      throw new IssueMediaProcessingError(
        "MEDIA_MIME_MISMATCH",
        "The declared MIME type does not match the image signature.",
      );
    }

    const output = await source
      .rotate()
      .resize({
        width: MAX_OUTPUT_EDGE,
        height: MAX_OUTPUT_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 5, smartSubsample: true })
      .toBuffer();
    const outputMetadata = await sharp(output).metadata();
    if (!outputMetadata.width || !outputMetadata.height) {
      throw new IssueMediaProcessingError(
        "MEDIA_PROCESSING_FAILED",
        "The normalized image dimensions could not be read.",
      );
    }
    return {
      body: output,
      sha256: createHash("sha256").update(input).digest("hex"),
      perceptualHash: await perceptualDifferenceHash(output),
      input: {
        mimeType: detectedMimeType,
        byteSize: input.byteLength,
        width: inputMetadata.width,
        height: inputMetadata.height,
      },
      output: {
        mimeType: "image/webp" as const,
        byteSize: output.byteLength,
        width: outputMetadata.width,
        height: outputMetadata.height,
      },
    };
  } catch (error) {
    if (error instanceof IssueMediaProcessingError) throw error;
    throw new IssueMediaProcessingError(
      "MEDIA_PROCESSING_FAILED",
      "The image could not be normalized safely.",
    );
  }
}

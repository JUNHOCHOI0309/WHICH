import { z } from "zod";
import { detectOcrPiiKinds } from "./ocr-pii.js";

export const EMBEDDED_TEXT_VERSION = "which-embedded-text-v1";
export const EMBEDDED_TEXT_MAX_CHARACTERS = 2000;
export const embeddedTextSchema = z
  .object({
    version: z.literal(EMBEDDED_TEXT_VERSION),
    status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "WITHHELD_PII"]),
    text: z.string().max(EMBEDDED_TEXT_MAX_CHARACTERS),
  })
  .strict();
export type EmbeddedText = z.infer<typeof embeddedTextSchema>;

// Transient worker IPC only. Never persist this object or log it.
export function minimizeEmbeddedText(
  raw: string,
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE",
): EmbeddedText {
  const text = raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/gu, "");
  if (detectOcrPiiKinds(text).length)
    return { version: EMBEDDED_TEXT_VERSION, status: "WITHHELD_PII", text: "" };
  const minimized = text
    .replace(/(?:https?:\/\/|www\.)\S+/giu, "[URL_REDACTED]")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    version: EMBEDDED_TEXT_VERSION,
    status:
      status === "COMPLETE" && minimized.length > EMBEDDED_TEXT_MAX_CHARACTERS ? "PARTIAL" : status,
    text: status === "UNAVAILABLE" ? "" : minimized.slice(0, EMBEDDED_TEXT_MAX_CHARACTERS),
  };
}

export const embeddedTextEvidenceSchema = z
  .object({
    version: z.literal(EMBEDDED_TEXT_VERSION),
    images: z
      .array(
        z
          .object({
            normalizedHash: z.string().regex(/^[a-f0-9]{64}$/u),
            status: embeddedTextSchema.shape.status,
            characters: z.number().int().min(0).max(EMBEDDED_TEXT_MAX_CHARACTERS),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type EmbeddedTextEvidence = z.infer<typeof embeddedTextEvidenceSchema>;

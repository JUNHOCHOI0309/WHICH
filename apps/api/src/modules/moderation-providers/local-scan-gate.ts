import type { ModerationProviderInput } from "./contracts.js";
import { ModerationProviderCallError } from "./contracts.js";

export function requireCompletePrivateLocalScan(input: ModerationProviderInput) {
  const statuses = input.embeddedText?.images.map((image) => image.status) ?? [];
  const imageCount = input.images?.length ?? 0;
  if (
    input.scope !== "SUBMISSION_REVISION" ||
    imageCount < 1 ||
    imageCount > 5 ||
    statuses.length !== imageCount
  )
    throw new ModerationProviderCallError(
      "INPUT_UNAVAILABLE",
      "LOCAL_SCAN_EVIDENCE_UNAVAILABLE",
      false,
    );
  if (statuses.some((status) => status === "WITHHELD_PII"))
    throw new ModerationProviderCallError("INPUT_UNAVAILABLE", "LOCAL_SCAN_PII_WITHHELD", false);
  if (statuses.some((status) => status === "PARTIAL"))
    throw new ModerationProviderCallError("INPUT_UNAVAILABLE", "LOCAL_SCAN_PARTIAL", false);
  if (statuses.some((status) => status === "UNAVAILABLE"))
    throw new ModerationProviderCallError("INPUT_UNAVAILABLE", "LOCAL_SCAN_UNAVAILABLE", false);
}

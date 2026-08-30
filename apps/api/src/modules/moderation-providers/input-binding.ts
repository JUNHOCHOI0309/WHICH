import { createHash } from "node:crypto";

import type { ModerationTargetType } from "../moderation-dispatch/contracts.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "./contracts.js";

export function moderationProviderCacheHash(target: {
  targetType: ModerationTargetType;
  normalizedInputHash: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        MODERATION_PROVIDER_INPUT_VERSION,
        target.targetType,
        target.normalizedInputHash,
      ]),
    )
    .digest("hex");
}

import { describe, expect, it } from "vitest";

import {
  CANONICAL_MODERATION_ACTIONS,
  COMMENT_MODERATION_ACTION_MAP,
  DETERMINISTIC_PRIVATE_REJECT_REASONS,
  HUMAN_ONLY_DECISIONS,
  ISSUE_MEDIA_REVIEW_ACTION_MAP,
  LEGACY_COMMENT_REPORT_REASON_MAP,
  MODERATION_ACTION_MATRIX,
  MODERATION_POLICY_AXES,
  MODERATION_POLICY_ROLLOUT,
  MODERATION_RIGHTS_AUTHORITY,
  MODERATION_REASON_CODES,
  MODERATION_REASON_REGISTRY,
  buildModerationNoticeKey,
  canSourceSetRightsState,
  mapCommentState,
  mapIssueMediaState,
  resolveModerationAuthority,
} from "../src/modules/moderation/policy-registry.js";

describe("moderation policy registry", () => {
  it("keeps the six independent policy axes and unique reason definitions", () => {
    expect(MODERATION_POLICY_AXES).toEqual([
      "TECHNICAL_SECURITY",
      "CONTENT_SAFETY",
      "PRIVACY",
      "RIGHTS",
      "RELEVANCE",
      "VISUAL_FAIRNESS",
    ]);
    expect(new Set(MODERATION_REASON_CODES).size).toBe(MODERATION_REASON_CODES.length);
    expect(MODERATION_REASON_REGISTRY.map((reason) => reason.code)).toEqual(
      MODERATION_REASON_CODES,
    );
  });

  it("allows deterministic private rejection for only the three approved technical reasons", () => {
    expect(DETERMINISTIC_PRIVATE_REJECT_REASONS).toEqual([
      "TECHNICAL_DECODE_FAILED",
      "TECHNICAL_PROHIBITED_FORMAT",
      "TECHNICAL_KNOWN_BLOCK_EXACT_HASH",
    ]);

    for (const reasonCode of DETERMINISTIC_PRIVATE_REJECT_REASONS) {
      expect(
        resolveModerationAuthority({
          source: "RULE",
          action: "PRIVATE_REJECT",
          reasonCode,
          contextState: "NOT_APPLICABLE",
        }),
      ).toMatchObject({ allowed: true, authority: "DETERMINISTIC_ONLY" });
    }

    expect(
      resolveModerationAuthority({
        source: "RULE",
        action: "PRIVATE_REJECT",
        reasonCode: "TECHNICAL_MALWARE_SUSPECTED",
        contextState: "NOT_APPLICABLE",
      }),
    ).toMatchObject({ allowed: false, fallbackAction: "REVIEW" });
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "PRIVATE_REJECT",
        reasonCode: "CONTENT_SEXUAL_EXPLOITATION",
        contextState: "SUFFICIENT",
      }),
    ).toMatchObject({ allowed: false, authority: "RECOMMEND_ONLY" });
  });

  it("routes missing context to review and gates every reversible automated exposure change", () => {
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "PUBLISHED",
        reasonCode: "PRIVACY",
        contextState: "INSUFFICIENT",
      }),
    ).toEqual({
      allowed: false,
      authority: "RECOMMEND_ONLY",
      fallbackAction: "REVIEW",
    });
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "REVIEW",
        reasonCode: "PRIVACY",
        contextState: "INSUFFICIENT",
      }),
    ).toMatchObject({ allowed: true, fallbackAction: "REVIEW" });
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "QUARANTINED",
        reasonCode: "CONTENT_GRAPHIC_VIOLENCE",
        contextState: "SUFFICIENT",
      }).allowed,
    ).toBe(false);
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "QUARANTINED",
        reasonCode: "CONTENT_GRAPHIC_VIOLENCE",
        contextState: "SUFFICIENT",
        releaseGateEnabled: true,
      }).allowed,
    ).toBe(true);
  });

  it("never gives a model direct purge authority and keeps irreversible decisions human-only", () => {
    expect(
      resolveModerationAuthority({
        source: "MODEL",
        action: "PURGED",
        reasonCode: "CONTENT_SEXUAL_EXPLOITATION",
        contextState: "SUFFICIENT",
        releaseGateEnabled: true,
      }),
    ).toMatchObject({ allowed: false, authority: "DENIED" });
    expect(
      resolveModerationAuthority({
        source: "OPERATOR",
        action: "PURGED",
        reasonCode: "CONTENT_SEXUAL_EXPLOITATION",
        contextState: "SUFFICIENT",
      }),
    ).toMatchObject({ allowed: true, authority: "ALLOWED" });
    expect(HUMAN_ONLY_DECISIONS).toEqual(
      expect.arrayContaining([
        "PERMANENT_CONTENT_DELETION",
        "FEATURE_RESTRICTION_OVER_24_HOURS",
        "APPEAL_DECISION",
        "RIGHTS_DECISION",
        "VOTE_INVALIDATION",
        "IDENTITY_DECISION",
        "MINOR_STATUS_DECISION",
      ]),
    );
    expect(MODERATION_RIGHTS_AUTHORITY.CLEARED).toEqual(["OPERATOR"]);
    expect(canSourceSetRightsState("MODEL", "CLEARED")).toBe(false);
    expect(canSourceSetRightsState("RULE", "CLEARED")).toBe(false);
    expect(canSourceSetRightsState("OPERATOR", "CLEARED")).toBe(true);
  });

  it("maps existing comment and Issue media ledgers without replacing their states", () => {
    expect(LEGACY_COMMENT_REPORT_REASON_MAP).toEqual({
      SPAM: "SPAM",
      HARASSMENT: "INSULT_OR_HARASSMENT",
      HATE_OR_ABUSE: "HATE",
      PERSONAL_INFORMATION: "PRIVACY",
      OTHER: "OTHER",
    });
    expect(COMMENT_MODERATION_ACTION_MAP).toEqual({
      COLLAPSE: "REVIEW",
      HIDE: "QUARANTINED",
      REMOVE_POLICY: "QUARANTINED",
      RESTORE: "PUBLISHED",
    });
    expect(ISSUE_MEDIA_REVIEW_ACTION_MAP).toEqual({
      APPROVED: "PUBLISHED",
      REJECTED: "PRIVATE_REJECT",
      HIDDEN: "QUARANTINED",
      RESTORED: "PUBLISHED",
      DELETED: "PURGED",
    });
    expect(
      mapCommentState({
        publicationState: "PUBLISHED",
        visibility: "HIDDEN",
        integrityState: "REVIEW",
      }),
    ).toBe("QUARANTINED");
    expect(
      mapCommentState({
        publicationState: "PUBLISHED",
        visibility: "REMOVED_BY_AUTHOR",
        integrityState: "NORMAL",
      }),
    ).toBeNull();
    expect(mapIssueMediaState({ moderationState: "APPROVED", storageState: "PUBLISHED" })).toBe(
      "PUBLISHED",
    );
    expect(mapIssueMediaState({ moderationState: "REVOKED", storageState: "QUARANTINED" })).toBe(
      "QUARANTINED",
    );
  });

  it("pins notice, canary and rollback contracts for every canonical action", () => {
    expect(MODERATION_ACTION_MATRIX.map((entry) => entry.action)).toEqual(
      CANONICAL_MODERATION_ACTIONS,
    );
    expect(
      MODERATION_ACTION_MATRIX.every((entry) => entry.noticeKey.startsWith("moderation.v1.")),
    ).toBe(true);
    expect(
      buildModerationNoticeKey({ action: "QUARANTINED", reasonCode: "PRIVACY_PII_DETECTED" }),
    ).toBe("moderation.v1.quarantined.privacy_pii_detected");
    expect(MODERATION_POLICY_ROLLOUT).toMatchObject({
      automationDefault: "OFF",
      minimumShadowDays: 30,
      rollbackAction: "REVIEW",
      policyVersionPinningRequired: true,
      killSwitchRequired: true,
    });
  });
});

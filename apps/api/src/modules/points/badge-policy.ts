export const POINT_BADGE_POLICY_VERSION = "w_badge_v1";

export const POINT_BADGE_CODES = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"] as const;

export type PointBadgeCode = (typeof POINT_BADGE_CODES)[number];

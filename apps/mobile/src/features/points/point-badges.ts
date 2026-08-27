export type PointBadgeCode = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export type PointBadge = {
  code: PointBadgeCode;
  label: string;
  minimumLifetimePoints: number;
};

const BRONZE_BADGE: PointBadge = {
  code: "BRONZE",
  label: "브론즈",
  minimumLifetimePoints: 0,
};

export const POINT_BADGES: readonly [PointBadge, ...PointBadge[]] = [
  BRONZE_BADGE,
  { code: "SILVER", label: "실버", minimumLifetimePoints: 1_000 },
  { code: "GOLD", label: "골드", minimumLifetimePoints: 2_500 },
  { code: "PLATINUM", label: "플래티넘", minimumLifetimePoints: 5_000 },
  { code: "DIAMOND", label: "다이아몬드", minimumLifetimePoints: 10_000 },
] as const;

export function pointBadgeFor(lifetimeEarned: number) {
  const safePoints = Math.max(0, lifetimeEarned);
  return (
    [...POINT_BADGES].reverse().find((badge) => safePoints >= badge.minimumLifetimePoints) ??
    BRONZE_BADGE
  );
}

export function nextPointBadge(lifetimeEarned: number) {
  const current = pointBadgeFor(lifetimeEarned);
  const index = POINT_BADGES.findIndex((badge) => badge.code === current.code);
  return POINT_BADGES[index + 1] ?? null;
}

export function pointBadgeProgress(lifetimeEarned: number) {
  const current = pointBadgeFor(lifetimeEarned);
  const next = nextPointBadge(lifetimeEarned);
  if (!next) return 1;
  const span = next.minimumLifetimePoints - current.minimumLifetimePoints;
  return Math.min(1, Math.max(0, (lifetimeEarned - current.minimumLifetimePoints) / span));
}

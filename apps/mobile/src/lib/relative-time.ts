export function relativeTimeLabel(value: string, now = Date.now()) {
  const createdAt = new Date(value).getTime();
  if (!Number.isFinite(createdAt)) return "시간 정보 없음";

  const seconds = Math.max(0, Math.floor((now - createdAt) / 1_000));
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

import type { MemberIssueSubmission } from "@/lib/contracts";

export function submissionOutcome(item: MemberIssueSubmission) {
  if (item.status === "CANCELLED" || item.publicationState === "CANCELLED") return "cancelled";
  if (
    ["NEEDS_CHANGES", "REJECTED", "QUARANTINED"].includes(item.publicationState) ||
    ["NEEDS_CHANGES", "REJECTED"].includes(item.status)
  )
    return "failed";
  if (item.publicationState === "PUBLISHED" && item.publishedIssueId) return "published";
  return "processing";
}

export function submissionFailureReason(item: MemberIssueSubmission) {
  if (item.reviewNote?.trim()) return item.reviewNote;
  if (item.publicationState === "QUARANTINED")
    return "이미지 공개가 보류되었어요. 이미지를 변경하거나 게시 상태를 확인해 주세요.";
  if (item.publicationState === "NEEDS_CHANGES" || item.status === "NEEDS_CHANGES")
    return "게시 전에 질문이나 이미지를 수정해야 해요.";
  return "이 질문 또는 이미지를 현재 게시할 수 없어요. 내용을 확인해 주세요.";
}

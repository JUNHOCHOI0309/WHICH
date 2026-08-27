import { useLocalSearchParams } from "expo-router";

import { IssueCommentsPanel } from "@/features/comments/issue-comments-panel";

export default function CommentsScreen() {
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  if (!issueId) return null;
  return <IssueCommentsPanel issueId={issueId} />;
}

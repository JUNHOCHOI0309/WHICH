import type { MemberPrivateVote, VoteResponse } from "@/contracts";

const votesByIssueId = new Map<string, VoteResponse>();

export function rememberMemberVote(vote: MemberPrivateVote) {
  const restored: VoteResponse = {
    outcome: "ACCEPTED",
    voteAttemptId: vote.voteId,
    voteId: vote.voteId,
    issueId: vote.issueId,
    issueVersion: vote.issueVersion,
    choice: vote.choice,
    result: vote.result,
  };
  votesByIssueId.set(vote.issueId, restored);
  return restored;
}

export function readRememberedMemberVote(issueId: string | undefined) {
  return issueId ? (votesByIssueId.get(issueId) ?? null) : null;
}

export function clearRememberedMemberVotes() {
  votesByIssueId.clear();
}

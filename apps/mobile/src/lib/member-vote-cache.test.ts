import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRememberedMemberVotes,
  readRememberedMemberVote,
  rememberMemberVote,
} from "./member-vote-cache";

const vote = {
  voteId: "d52dace5-486c-5e34-bb73-5a0b5a779c98",
  issueId: "591f2e90-996a-50c5-af46-967dd0793000",
  issueVersion: 2,
  question: "어느 쪽인가요?",
  categoryCode: "LIFE",
  choice: "B" as const,
  choiceLabel: "두 번째 선택",
  acceptedAt: "2026-08-27T00:00:00.000Z",
  result: {
    resultVersion: 7,
    acceptedA: 12,
    acceptedB: 15,
    displayedTotal: 27,
    integrityState: "NORMAL",
  },
};

describe("Member Vote memory cache", () => {
  beforeEach(clearRememberedMemberVotes);

  it("restores an authenticated history item for the matching Issue", () => {
    rememberMemberVote(vote);

    expect(readRememberedMemberVote(vote.issueId)).toEqual({
      outcome: "ACCEPTED",
      voteAttemptId: vote.voteId,
      voteId: vote.voteId,
      issueId: vote.issueId,
      issueVersion: vote.issueVersion,
      choice: vote.choice,
      result: vote.result,
    });
  });

  it("does not expose remembered history after the Member session is cleared", () => {
    rememberMemberVote(vote);
    clearRememberedMemberVotes();

    expect(readRememberedMemberVote(vote.issueId)).toBeNull();
  });
});

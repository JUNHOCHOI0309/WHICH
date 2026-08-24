import { describe, expect, it } from "vitest";

import { computeIssueContentHash } from "../src/modules/issue-publication/content-hash.js";
import { buildExpandedIssuePacks } from "../src/modules/issue-publication/editorial-catalog.js";

const approvedAt = "2026-08-25T12:00:00.000+09:00";

function createIssue() {
  const issue = {
    candidateId: "WEXP-0001",
    id: "04f0ee31-f57c-5333-bdd2-9041a2440640",
    version: 1,
    question: "공식 자료가 필요한 질문은 어떻게 게시할까요?",
    context: "사람 검토와 출처 재검토를 모두 마친 상황입니다.",
    choices: [
      {
        id: "4506f627-6ac4-57bd-8e61-aab8bb47748a",
        code: "A" as const,
        label: "검토 기한을 짧게 두기",
      },
      {
        id: "1147edf8-4f5e-50c3-b8e4-6eb02b803451",
        code: "B" as const,
        label: "출처를 더 많이 연결하기",
      },
    ] as const,
    primaryCategoryCode: "SOCIETY",
    interestCardCodes: ["SOCIETY"] as const,
    experienceModeCode: "PLAYFUL_QUICK",
    taxonomyVersion: "taxonomy_v2.0",
    editorialArea: "CURRENT_SOCIAL",
    riskLevel: "LOW" as const,
    isPolitical: false as const,
    sourceProfile: {
      discoveryLead: "OFFICIAL" as const,
      sourceRequirement: "SOURCE_REQUIRED" as const,
      communitySignalIds: [],
      communitySignalRole: "NONE",
      factSourceIds: ["OFF-TEST-20260825"],
      asOf: "2026-08-25",
      reviewAfter: "2026-09-25",
      expiresAt: "2026-10-25",
      evergreen: false,
      sourceFitReview: "PASSED",
    },
    contentHash: "",
    editorialReview: {
      status: "HUMAN_APPROVED" as const,
      humanApproval: "APPROVED" as const,
      reviewedBy: "WHICH_PRODUCT_OWNER",
      reviewedAt: approvedAt,
      binaryFit: "PASSED" as const,
      choiceParity: "PASSED" as const,
      duplicateReview: "PASSED" as const,
      sourceReview: "PASSED" as const,
    },
  };
  issue.contentHash = computeIssueContentHash(issue);
  return issue;
}

function createFixture() {
  const issue = createIssue();
  return {
    issue,
    catalog: {
      schemaVersion: 2,
      catalogId: "which-expanded-test-v2",
      taxonomyVersion: "taxonomy_v2.0",
      approval: {
        status: "HUMAN_APPROVED",
        humanApprovalRequired: false,
        automatedValidation: "PASSED",
        approvedBy: "WHICH_PRODUCT_OWNER",
        approvedAt,
      },
      issues: [issue],
    },
    registry: {
      schemaVersion: 1,
      asOf: "2026-08-25",
      sources: [
        {
          id: "OFF-TEST-20260825",
          publisher: "공식 테스트 기관",
          title: "직접 근거가 되는 공식 자료",
          url: "https://example.com/official-source",
          publishedAt: "2026-08-25",
          topics: ["TEST"],
        },
      ],
    },
    plan: {
      schemaVersion: 1,
      catalogId: "which-expanded-test-v2",
      target: "production",
      approval: {
        status: "APPROVED",
        approvedBy: "WHICH_PRODUCT_OWNER",
        approvedAt,
      },
      packs: [
        {
          fileName: "which-expanded-test-day-1-v1.json",
          packId: "which-expanded-test-day-1-v1",
          publicationAt: "2026-08-26T10:00:00.000+09:00",
          candidateIds: ["WEXP-0001"],
        },
      ],
    },
  };
}

describe("Expanded Editorial Catalog v2", () => {
  it("builds only a human-approved LOW candidate and resolves official source URLs", () => {
    const fixture = createFixture();
    const [built] = buildExpandedIssuePacks(fixture.catalog, fixture.registry, fixture.plan, {
      now: new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(built?.manifest.issues).toHaveLength(1);
    expect(built?.manifest.issues[0]?.editorialReview?.sourceUrls).toEqual([
      "https://example.com/official-source",
    ]);
  });

  it("fails closed while catalog approval is pending", () => {
    const fixture = createFixture();
    fixture.catalog.approval = {
      status: "PENDING_HUMAN_EDITORIAL_APPROVAL",
      humanApprovalRequired: true,
      automatedValidation: "PASSED",
      approvedBy: null,
      approvedAt: null,
    } as never;

    expect(() =>
      buildExpandedIssuePacks(fixture.catalog, fixture.registry, fixture.plan, {
        now: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).toThrow(/not human-approved/);
  });

  it("blocks stale source reviews and MEDIUM candidates", () => {
    const stale = createFixture();
    stale.issue.sourceProfile.reviewAfter = "2026-08-24";
    expect(() =>
      buildExpandedIssuePacks(stale.catalog, stale.registry, stale.plan, {
        now: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).toThrow(/re-review is required/);

    const medium = createFixture();
    medium.issue.riskLevel = "MEDIUM" as never;
    expect(() =>
      buildExpandedIssuePacks(medium.catalog, medium.registry, medium.plan, {
        now: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).toThrow(/separate risk approval route/);
  });

  it("checks wording against previously approved manifests", () => {
    const fixture = createFixture();
    const comparison = {
      ...fixture.issue,
      id: "72b38200-9924-4b0d-a066-7b08e10c4d70",
      choices: [
        { ...fixture.issue.choices[0], id: "2b06880f-e1f2-4baa-85aa-f50dd0d428b6" },
        { ...fixture.issue.choices[1], id: "05f431d8-56f2-4208-b53b-e664ece7a04b" },
      ],
    };

    expect(() =>
      buildExpandedIssuePacks(fixture.catalog, fixture.registry, fixture.plan, {
        now: new Date("2026-08-25T00:00:00.000Z"),
        comparisonIssues: [comparison as never],
      }),
    ).toThrow(/duplicates approved Issue/);
  });
});

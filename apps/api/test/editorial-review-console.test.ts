import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createEditorialReviewApp } from "../src/editorial-review-console.js";
import {
  expandedEditorialCatalogSchema,
  expandedPublicationPlanSchema,
} from "../src/modules/issue-publication/editorial-catalog.js";
import {
  EditorialReviewConsole,
  type ReviewConsolePaths,
} from "../src/modules/issue-publication/review-console.js";

const contentDirectory = resolve(import.meta.dirname, "../content/editorial/expanded");
const temporaryDirectories: string[] = [];

async function createConsole() {
  const temporary = await mkdtemp(join(tmpdir(), "which-editorial-review-"));
  temporaryDirectories.push(temporary);
  const paths: ReviewConsolePaths = {
    catalog: join(contentDirectory, "which-expanded-500-catalog-v2.json"),
    inventory: join(contentDirectory, "inventory-candidates-v2.json"),
    factSources: join(contentDirectory, "fact-source-registry-v2.json"),
    communitySources: join(contentDirectory, "community-source-registry-v2.json"),
    decisions: join(temporary, "editorial-review-decisions-v1.json"),
    outputDirectory: join(temporary, "approved"),
  };
  return { service: await EditorialReviewConsole.load(paths), paths };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Editorial Review Console", () => {
  it("loads the complete candidate inventory and stores decisions separately", async () => {
    const { service, paths } = await createConsole();
    const before = service.getState();
    expect(before.catalog.total).toBe(662);
    expect(before.inventory).toEqual({ active: 72, reserve: 108, longTerm: 482 });
    expect(before.counts.PENDING).toBe(662);

    const saved = await service.saveDecision("WEXP-0001", {
      status: "APPROVED",
      note: "A/B와 출처 조건을 확인했습니다.",
      reviewedBy: "WHICH_PRODUCT_OWNER",
      checks: {
        binaryFit: true,
        choiceParity: true,
        duplicateReview: true,
        sourceReview: true,
      },
    });
    expect(saved.status).toBe("APPROVED");
    const persisted = JSON.parse(await readFile(paths.decisions, "utf8")) as {
      decisions: Array<{ candidateId: string }>;
    };
    expect(persisted.decisions.map((decision) => decision.candidateId)).toEqual(["WEXP-0001"]);
    expect(service.getState().counts.APPROVED).toBe(1);
  });

  it("requires every human check before approval", async () => {
    const { service } = await createConsole();
    await expect(
      service.saveDecision("WEXP-0001", {
        status: "APPROVED",
        note: "",
        reviewedBy: "WHICH_PRODUCT_OWNER",
        checks: {
          binaryFit: true,
          choiceParity: true,
          duplicateReview: false,
          sourceReview: true,
        },
      }),
    ).rejects.toThrow(/네 가지 편집 검수/);
  });

  it("exports only approved LOW candidates as a validated catalog and plan", async () => {
    const { service } = await createConsole();
    await service.saveDecision("WEXP-0001", {
      status: "APPROVED",
      note: "승인",
      reviewedBy: "WHICH_PRODUCT_OWNER",
      checks: {
        binaryFit: true,
        choiceParity: true,
        duplicateReview: true,
        sourceReview: true,
      },
    });
    await service.saveDecision("WEXP-0016", {
      status: "REJECTED",
      note: "범위가 모호함",
      reviewedBy: "WHICH_PRODUCT_OWNER",
      checks: {
        binaryFit: false,
        choiceParity: false,
        duplicateReview: true,
        sourceReview: true,
      },
    });

    const result = await service.exportApproved({
      scope: "ACTIVE",
      startAt: "2026-08-26T10:00:00.000+09:00",
      dailyTarget: 6,
      reviewedBy: "WHICH_PRODUCT_OWNER",
      overwrite: false,
    });
    expect(result).toMatchObject({ count: 1, packs: 1 });
    const catalog = expandedEditorialCatalogSchema.parse(
      JSON.parse(await readFile(result.catalogPath, "utf8")),
    );
    const plan = expandedPublicationPlanSchema.parse(
      JSON.parse(await readFile(result.planPath, "utf8")),
    );
    expect(catalog.approval.status).toBe("HUMAN_APPROVED");
    expect(catalog.issues.map((issue) => issue.candidateId)).toEqual(["WEXP-0001"]);
    expect(plan.packs[0]?.candidateIds).toEqual(["WEXP-0001"]);
  });

  it("serves the console only for loopback hosts and validates write requests", async () => {
    const { service } = await createConsole();
    const app = await createEditorialReviewApp(service);
    const page = await app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:4317" } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Editorial Review");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { host: "example.com" },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/decisions/WEXP-0001",
      headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" },
      payload: {
        status: "APPROVED",
        note: "",
        reviewedBy: "WHICH_PRODUCT_OWNER",
        checks: {
          binaryFit: true,
          choiceParity: true,
          duplicateReview: false,
          sourceReview: true,
        },
      },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});

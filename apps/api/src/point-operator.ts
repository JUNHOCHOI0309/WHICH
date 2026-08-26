import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import { config as loadEnvironment } from "dotenv";

import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import {
  createPointIntegrityService,
  type PointReconciliationReport,
  type PointReversalReport,
} from "./modules/points/integrity.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

function options(arguments_: string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid option near ${key ?? "end"}.`);
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function required(values: Map<string, string>, key: string) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

async function saveArtifact(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolute;
}

async function loadArtifact<T>(path: string, kind: string) {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as T & { kind?: unknown };
  if (parsed.kind !== kind) throw new Error(`Expected a ${kind} artifact.`);
  return parsed;
}

function adjustmentConfirmation(input: {
  targetEnvironment: string;
  targetMemberId: string;
  amount: number;
  incidentId: string;
}) {
  return `${input.targetEnvironment}:point-adjustment:${input.incidentId}:${input.targetMemberId}:${input.amount}`;
}

async function main() {
  const [command = "help", ...arguments_] = process.argv.slice(2);
  const values = options(arguments_);
  const config = getConfig();
  const targetEnvironment = config.environment;
  const database = createDatabase(config.databaseUrl);
  const service = createPointIntegrityService(database.db, { targetEnvironment });
  try {
    const operatorMemberId = required(values, "operator");
    if (command === "reconcile") {
      const report = await service.reconcile({
        operatorMemberId,
        memberId: values.get("member"),
        requestId: "point-operator:reconcile",
      });
      const path = await saveArtifact(
        values.get("artifact") ?? "artifacts/point-reconciliation.json",
        report,
      );
      console.log(JSON.stringify({ mode: "DRY_RUN", artifact: path, ...report }, null, 2));
      return;
    }
    if (command === "repair") {
      const report = await loadArtifact<PointReconciliationReport>(
        required(values, "artifact"),
        "POINT_RECONCILIATION",
      );
      console.log(
        JSON.stringify(
          await service.repair({
            operatorMemberId,
            report,
            confirm: required(values, "confirm"),
            requestId: "point-operator:repair",
          }),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "reversals") {
      const report = await service.planInvalidatedVoteReversals({
        operatorMemberId,
        requestId: "point-operator:reversals",
      });
      const path = await saveArtifact(
        values.get("artifact") ?? "artifacts/point-reversals.json",
        report,
      );
      console.log(JSON.stringify({ mode: "DRY_RUN", artifact: path, ...report }, null, 2));
      return;
    }
    if (command === "apply-reversals") {
      const report = await loadArtifact<PointReversalReport>(
        required(values, "artifact"),
        "POINT_INVALIDATED_VOTE_REVERSAL",
      );
      console.log(
        JSON.stringify(
          await service.applyInvalidatedVoteReversals({
            operatorMemberId,
            report,
            confirm: required(values, "confirm"),
            requestId: "point-operator:apply-reversals",
          }),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "adjust") {
      const targetMemberId = required(values, "member");
      const amount = Number.parseInt(required(values, "amount"), 10);
      const incidentId = required(values, "incident");
      const confirmation = adjustmentConfirmation({
        targetEnvironment,
        targetMemberId,
        amount,
        incidentId,
      });
      if (!values.get("confirm")) {
        console.log(
          JSON.stringify(
            {
              mode: "DRY_RUN",
              targetEnvironment,
              operatorMemberId,
              targetMemberId,
              amount,
              incidentId,
              reason: required(values, "reason"),
              confirmationToken: confirmation,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (values.get("confirm") !== confirmation) {
        throw new Error("The explicit adjustment confirmation token does not match the Dry Run.");
      }
      console.log(
        JSON.stringify(
          await service.adjust({
            operatorMemberId,
            targetMemberId,
            amount,
            incidentId,
            reason: required(values, "reason"),
            idempotencyKey: required(values, "idempotency"),
            requestId: "point-operator:adjust",
          }),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "ledger") {
      console.log(
        JSON.stringify(
          await service.listLedger({
            operatorMemberId,
            memberId: values.get("member"),
            sourceEventId: values.get("event"),
            sourceType: values.get("source-type"),
            from: values.get("from"),
            to: values.get("to"),
            limit: values.get("limit") ? Number.parseInt(values.get("limit")!, 10) : undefined,
            requestId: "point-operator:ledger",
          }),
          null,
          2,
        ),
      );
      return;
    }
    throw new Error(
      "Usage: point-operator <reconcile|repair|reversals|apply-reversals|adjust|ledger> --operator <member-uuid> [options]",
    );
  } finally {
    await database.close();
  }
}

if (
  process.argv[1]?.endsWith("point-operator.ts") ||
  process.argv[1]?.endsWith("point-operator.js")
) {
  await main();
}

import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getConfig } from "./config.js";
import { createDatabase, type Database } from "./database/client.js";
import {
  memberCredentials,
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  operatorBackupConfirmations,
} from "./database/schema/index.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveMemberId(database: Database["db"], identifier: string) {
  if (uuidPattern.test(identifier)) {
    const rows = await database
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, identifier), eq(members.status, "ACTIVE")))
      .limit(1);
    return rows[0]?.id ?? null;
  }
  const rows = await database
    .select({ id: members.id })
    .from(memberCredentials)
    .innerJoin(members, eq(members.id, memberCredentials.memberId))
    .where(
      and(
        eq(memberCredentials.emailNormalized, identifier.trim().toLocaleLowerCase("en-US")),
        eq(members.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function grant(database: Database["db"], identifier: string, actor: string) {
  const memberId = await resolveMemberId(database, identifier);
  if (!memberId) throw new Error("An active Member matching the identifier was not found.");
  const active = await database
    .select({ id: operatorAccessGrants.id })
    .from(operatorAccessGrants)
    .where(and(eq(operatorAccessGrants.memberId, memberId), isNull(operatorAccessGrants.revokedAt)))
    .limit(1);
  if (active[0]) return { memberId, changed: false, role: "OPERATOR" as const };
  await database.transaction(async (transaction) => {
    await transaction.insert(operatorAccessGrants).values({ memberId, grantedBy: actor });
    await transaction.insert(operatorAuditLogs).values({
      memberId,
      eventType: "OPERATOR_ROLE_GRANTED",
      outcome: "SUCCEEDED",
      metadata: { actor },
    });
  });
  return { memberId, changed: true, role: "OPERATOR" as const };
}

async function revoke(database: Database["db"], identifier: string, actor: string) {
  const memberId = await resolveMemberId(database, identifier);
  if (!memberId) throw new Error("An active Member matching the identifier was not found.");
  const result = await database.transaction(async (transaction) => {
    const revoked = await transaction
      .update(operatorAccessGrants)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(operatorAccessGrants.memberId, memberId), isNull(operatorAccessGrants.revokedAt)),
      )
      .returning({ id: operatorAccessGrants.id });
    await transaction.insert(operatorAuditLogs).values({
      memberId,
      eventType: "OPERATOR_ROLE_REVOKED",
      outcome: "SUCCEEDED",
      metadata: { actor, changed: revoked.length > 0 },
    });
    return revoked.length > 0;
  });
  return { memberId, changed: result };
}

async function confirmBackup(
  database: Database["db"],
  identifier: string,
  backupReference: string,
  notes?: string,
) {
  const memberId = await resolveMemberId(database, identifier);
  if (!memberId) throw new Error("An active Member matching the identifier was not found.");
  const active = await database
    .select({ id: operatorAccessGrants.id })
    .from(operatorAccessGrants)
    .where(and(eq(operatorAccessGrants.memberId, memberId), isNull(operatorAccessGrants.revokedAt)))
    .limit(1);
  if (!active[0]) throw new Error("Backup confirmation requires an active OPERATOR grant.");
  const confirmation = await database.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(operatorBackupConfirmations)
      .values({ confirmedByMemberId: memberId, backupReference, notes })
      .returning({
        id: operatorBackupConfirmations.id,
        confirmedAt: operatorBackupConfirmations.confirmedAt,
      });
    await transaction.insert(operatorAuditLogs).values({
      memberId,
      eventType: "BACKUP_CONFIRMED",
      outcome: "SUCCEEDED",
      metadata: { backupReference },
    });
    return inserted[0]!;
  });
  return { memberId, backupReference, ...confirmation };
}

async function listOperators(database: Database["db"]) {
  return database
    .select({
      memberId: operatorAccessGrants.memberId,
      displayName: members.displayName,
      role: operatorAccessGrants.role,
      grantedBy: operatorAccessGrants.grantedBy,
      grantedAt: operatorAccessGrants.grantedAt,
    })
    .from(operatorAccessGrants)
    .innerJoin(members, eq(members.id, operatorAccessGrants.memberId))
    .where(isNull(operatorAccessGrants.revokedAt))
    .orderBy(desc(operatorAccessGrants.grantedAt));
}

async function main() {
  const [command, identifier, value, ...rest] = process.argv.slice(2);
  const database = createDatabase(getConfig().databaseUrl);
  const actor = process.env.OPS_CHANGE_ACTOR?.trim() || "render-shell";
  try {
    if (command === "grant" && identifier) {
      console.log(JSON.stringify(await grant(database.db, identifier, actor), null, 2));
      return;
    }
    if (command === "revoke" && identifier) {
      console.log(JSON.stringify(await revoke(database.db, identifier, actor), null, 2));
      return;
    }
    if (command === "confirm-backup" && identifier && value) {
      console.log(
        JSON.stringify(
          await confirmBackup(database.db, identifier, value, rest.join(" ") || undefined),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "list") {
      console.log(JSON.stringify(await listOperators(database.db), null, 2));
      return;
    }
    throw new Error(
      "Usage: ops-operator <grant|revoke> <member-id-or-email> | list | confirm-backup <member-id-or-email> <reference> [notes]",
    );
  } finally {
    await database.close();
  }
}

if (process.argv[1]?.endsWith("ops-operator.ts") || process.argv[1]?.endsWith("ops-operator.js")) {
  await main();
}

import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { getConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { assertDevelopmentSeedAllowed, seedDevelopmentIssues } from "./development-seed.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const config = getConfig();
assertDevelopmentSeedAllowed(config.environment);

const database = createDatabase(config.databaseUrl);

try {
  const seededIssues = await seedDevelopmentIssues(database.db);
  console.log(`Development Issues ready: ${seededIssues.map((issue) => issue.id).join(", ")}`);
  console.log("Development Comments ready for every Issue side.");
} finally {
  await database.close();
}

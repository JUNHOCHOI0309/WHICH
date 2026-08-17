import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { createIssueReadService } from "./modules/issues/service.js";
import { createGuestVoteService } from "./modules/voting/service.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const config = getConfig();
const database = createDatabase(config.databaseUrl);
const app = await buildApp(config, {
  ...database,
  issueReader: createIssueReadService(database.db),
  guestVotes: createGuestVoteService(database.db),
});

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

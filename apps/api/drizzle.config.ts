import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://which:which_local@localhost:54329/which",
  },
  strict: true,
  verbose: true,
});

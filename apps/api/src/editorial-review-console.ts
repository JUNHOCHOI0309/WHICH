import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  editorialReviewCss,
  editorialReviewHtml,
  editorialReviewJs,
} from "./editorial-review-ui.js";
import {
  EditorialReviewConsole,
  type ReviewConsolePaths,
} from "./modules/issue-publication/review-console.js";

function findExpandedContentDirectory() {
  const candidates = [
    resolve(process.cwd(), "content/editorial/expanded"),
    resolve(process.cwd(), "apps/api/content/editorial/expanded"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Expanded editorial content directory was not found.");
  return found;
}

export function defaultReviewConsolePaths(
  contentDirectory = findExpandedContentDirectory(),
): ReviewConsolePaths {
  return {
    catalog: resolve(contentDirectory, "which-expanded-500-catalog-v2.json"),
    inventory: resolve(contentDirectory, "inventory-candidates-v2.json"),
    factSources: resolve(contentDirectory, "fact-source-registry-v2.json"),
    communitySources: resolve(contentDirectory, "community-source-registry-v2.json"),
    decisions: resolve(contentDirectory, "editorial-review-decisions-v1.json"),
    outputDirectory: resolve(contentDirectory, "approved"),
  };
}

function isLoopbackHost(value: string | undefined) {
  return /^(?:127\.0\.0\.1|localhost)(?::[0-9]+)?$/.test(value ?? "");
}

function isLoopbackOrigin(value: string | undefined) {
  if (!value) return true;
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export async function createEditorialReviewApp(
  consoleService: EditorialReviewConsole,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHost(request.headers.host)) {
      return reply
        .code(403)
        .send({ message: "Editorial Review Console accepts loopback requests only." });
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !isLoopbackOrigin(request.headers.origin)
    ) {
      return reply.code(403).send({ message: "Cross-origin review writes are not allowed." });
    }
  });

  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(editorialReviewHtml),
  );
  app.get("/styles.css", async (_request, reply) =>
    reply.type("text/css; charset=utf-8").send(editorialReviewCss),
  );
  app.get("/app.js", async (_request, reply) =>
    reply.type("application/javascript; charset=utf-8").send(editorialReviewJs),
  );
  app.get("/health", () => ({ ok: true, localOnly: true }));
  app.get("/api/state", () => consoleService.getState());
  app.put<{ Params: { candidateId: string } }>("/api/decisions/:candidateId", async (request) =>
    consoleService.saveDecision(request.params.candidateId, request.body),
  );
  app.post("/api/export", async (request) => consoleService.exportApproved(request.body));

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const message = error instanceof ZodError ? error.issues[0]?.message : error.message;
    void reply.code(error instanceof ZodError ? 400 : 409).send({
      message: message || "Editorial Review 요청을 처리하지 못했습니다.",
    });
  });
  return app;
}

function parsePort(values: string[]) {
  if (values.length === 0) return 4317;
  if (values.length === 2 && values[0] === "--port") {
    const port = Number(values[1]);
    if (Number.isInteger(port) && port >= 1024 && port <= 65_535) return port;
  }
  throw new Error("Usage: pnpm --filter @which/api issues:review [--port 4317]");
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  const consoleService = await EditorialReviewConsole.load(defaultReviewConsolePaths());
  const app = await createEditorialReviewApp(consoleService);
  await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(`WHICH Editorial Review Console: http://127.0.0.1:${port}\n`);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

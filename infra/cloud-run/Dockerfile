FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm --filter @which/api --filter @which/web install --frozen-lockfile
COPY . .
RUN pnpm --filter @which/api build
RUN NEXT_STANDALONE=true pnpm --filter @which/web build
RUN pnpm --filter @which/api deploy --prod --legacy --frozen-lockfile /api-runtime

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /api-runtime/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /api-runtime/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/content ./apps/api/content
COPY --from=build --chown=node:node /app/scripts/cloud-run ./scripts/cloud-run
USER node
EXPOSE 8080
CMD ["node", "scripts/cloud-run/start.mjs"]

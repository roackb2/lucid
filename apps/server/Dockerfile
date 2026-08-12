# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_IMAGE} AS build-dependencies
WORKDIR /opt/lucid
RUN corepack enable \
  && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
  yarn install --frozen-lockfile --non-interactive --prefer-offline \
    --network-timeout 600000

FROM build-dependencies AS build
COPY apps/server/src ./apps/server/src
COPY apps/web/index.html apps/web/postcss.config.cjs apps/web/tailwind.config.js apps/web/vite.config.ts ./apps/web/
COPY apps/web/src ./apps/web/src
RUN yarn workspace @lucid/server build \
  && yarn workspace @lucid/web build

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /opt/lucid
RUN corepack enable \
  && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock ./
COPY apps/server/package.json ./apps/server/package.json
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
  yarn install --frozen-lockfile --non-interactive --production=true \
    --prefer-offline --network-timeout 600000

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lucid
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8081 \
  LUCID_STATE_ROOT=/var/lib/lucid \
  LUCID_WEB_ROOT=/opt/lucid/apps/web/dist
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/server/package.json ./apps/server/package.json
COPY --chown=node:node --from=production-dependencies /opt/lucid/node_modules ./node_modules
COPY --chown=node:node --from=build /opt/lucid/apps/server/dist ./apps/server/dist
COPY --chown=node:node --from=build /opt/lucid/apps/web/dist ./apps/web/dist
COPY --chown=node:node apps/server/drizzle ./apps/server/drizzle
RUN mkdir -p /var/lib/lucid \
  && chown node:node /var/lib/lucid
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? '8081'}/healthz`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/server.js"]

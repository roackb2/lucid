# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_IMAGE} AS build
WORKDIR /build
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock tsconfig.base.json ./
COPY apps/agent-runtime/package.json apps/agent-runtime/package.json
RUN yarn install --frozen-lockfile
COPY apps/agent-runtime/tsconfig.json apps/agent-runtime/tsconfig.json
COPY apps/agent-runtime/src apps/agent-runtime/src
RUN yarn workspace @lucid/agent-runtime build

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /build
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock ./
COPY apps/agent-runtime/package.json apps/agent-runtime/package.json
RUN yarn install --frozen-lockfile --production=true \
  && mkdir -p apps/agent-runtime/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    LUCID_AGENT_RUNTIME_WORKSPACE_ROOT=/workspace \
    LUCID_AGENT_RUNTIME_STATE_ROOT=/runtime/state

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    coreutils \
    curl \
    findutils \
    git \
    jq \
    procps \
    python3 \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare yarn@1.22.22 --activate \
  && mkdir -p /opt/lucid/apps/agent-runtime /runtime/state /workspace \
  && chown -R node:node /opt/lucid /runtime /workspace

WORKDIR /opt/lucid
COPY --chown=node:node package.json yarn.lock ./
COPY --chown=node:node apps/agent-runtime/package.json apps/agent-runtime/package.json
COPY --chown=node:node --from=production-dependencies /build/node_modules node_modules
COPY --chown=node:node --from=production-dependencies /build/apps/agent-runtime/node_modules apps/agent-runtime/node_modules
COPY --chown=node:node --from=build /build/apps/agent-runtime/dist apps/agent-runtime/dist

USER node
WORKDIR /workspace
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/ping >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/lucid/apps/agent-runtime/dist/server.js"]

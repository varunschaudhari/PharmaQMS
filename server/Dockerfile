# Build context is the repo ROOT (npm workspaces monorepo, single root package-lock.json) —
# see docker-compose.yml's `build.context: .` / `build.dockerfile: server/Dockerfile`.

# Debian-based (not Alpine): puppeteer's bundled Chromium is glibc-linked and needs these shared
# libs to launch; musl-based Alpine cannot run it without extra repackaging.
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation wget xdg-utils \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 \
    libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-6 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared packages/shared
COPY server server
RUN npm run build -w @pharmaqms/shared && npm run build -w server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY server/package.json ./server/package.json
EXPOSE 4000
CMD ["node", "server/dist/main.js"]

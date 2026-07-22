# Build context is the repo ROOT (npm workspaces monorepo, single root package-lock.json) —
# see docker-compose.yml's `build.context: .` / `build.dockerfile: client/Dockerfile`.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
# VITE_* vars are inlined into the static bundle at build time (browser-side code, so these must
# be reachable from the USER'S browser, not container-internal service names).
ARG VITE_API_URL=http://localhost:4000/api/v1
ARG VITE_DEFAULT_TENANT_ID=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEFAULT_TENANT_ID=$VITE_DEFAULT_TENANT_ID
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared packages/shared
COPY client client
RUN npm run build -w @pharmaqms/shared && npm run build -w client

FROM nginx:1.27-alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80

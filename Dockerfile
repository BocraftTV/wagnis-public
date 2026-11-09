# Wagnis server image. Published for linux/arm64 and linux/amd64 as ghcr.io/bocrafttv/wagnis by the public repo's image workflow.
# Local build: docker buildx build --platform linux/arm64 --build-arg NODE_VERSION=$(cat .node-version) -t wagnis:<tag> --load .
# Must match .node-version; the build command passes it from the file.
ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
# --ignore-scripts: better-sqlite3 ships binding.gyp without an install script, so npm would run node-gyp (no
# compiler in this image); the prebuilt binary from the package is verified in the runtime stage instead.
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --omit=dev --ignore-scripts

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 WAGNIS_DB_PATH=/data/wagnis.db
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/engine/package.json packages/engine/package.json
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist
# Fails the build if the prebuilt better-sqlite3 binary does not load here; no compiler fallback.
RUN node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); console.log('sqlite', d.prepare('select sqlite_version() v').get().v); d.close()" \
    && mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]

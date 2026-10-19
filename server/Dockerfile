FROM node:22-slim AS build
WORKDIR /app
# Native SQLite bindings must also build when a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm run build -w server && npm prune --omit=dev --workspace server --include-workspace-root=false && mkdir -p server/node_modules

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
EXPOSE 4000
CMD ["node", "server/dist/index.js"]

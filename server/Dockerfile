FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm run build -w server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false
COPY --from=build /app/server/dist ./server/dist
EXPOSE 4000
CMD ["node", "server/dist/index.js"]

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root=false
COPY web/ ./web/
RUN npm run build -w web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
EXPOSE 3000
CMD ["node", "web/server.js"]

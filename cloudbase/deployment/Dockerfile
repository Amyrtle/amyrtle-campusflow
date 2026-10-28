FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/api/package.json ./services/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY services/api ./services/api
RUN npm run build -w @campusflow/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/services/api/dist ./services/api/dist
COPY cloudbase/migrations ./cloudbase/migrations
USER node
EXPOSE 3001
CMD ["node", "services/api/dist/server.js"]

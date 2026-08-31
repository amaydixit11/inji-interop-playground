# Single image serving both the BFF and the built UI, so the playground is one
# container rather than two that have to agree on a proxy configuration.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bff/package.json apps/bff/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bff/package.json apps/bff/
RUN npm ci --omit=dev --workspace @interop/bff --workspace @interop/shared --include-workspace-root

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/bff/dist apps/bff/dist
COPY --from=build /app/apps/web/dist apps/web/dist

# Keys and run history live on a volume so credentials issued in one session
# still verify in the next and the DID document stays stable across restarts.
VOLUME ["/app/.keys", "/app/runs"]

EXPOSE 8787
CMD ["node", "apps/bff/dist/index.js"]

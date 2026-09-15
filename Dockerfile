FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json server.ts http.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production VAULT_PATH=/vault PORT=3333
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN apk add --no-cache su-exec
COPY docker-entrypoint.sh /usr/local/bin/
# Runs as root only long enough to fix volume ownership, then drops to node (uid 1000),
# which matches PUID in the Obsidian container so both can write the vault
ENTRYPOINT ["sh", "/usr/local/bin/docker-entrypoint.sh"]
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3333/healthz || exit 1
CMD ["node", "dist/http.js"]

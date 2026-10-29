FROM cloudron/node-base:24-20261021@sha256:7435d8aca138ce01cfca4cd7ec05683223b8f5d7198c9abdaaefa1b6ba14b4c6 AS build

WORKDIR /build
RUN npm install -g pnpm@10.34.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm exec tsup && pnpm prune --prod --ignore-scripts

FROM cloudron/node-base:24-20261021@sha256:7435d8aca138ce01cfca4cd7ec05683223b8f5d7198c9abdaaefa1b6ba14b4c6

LABEL org.opencontainers.image.source="https://github.com/mattstyles333/mcp-cloudron" \
      org.opencontainers.image.description="Cloudron MCP: MCP server and settings UI for managing a Cloudron" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app/code
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json ./
COPY ui ./ui
COPY resources ./resources
COPY start.sh ./

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UI_DIR=/app/code/ui

CMD [ "/app/code/start.sh" ]

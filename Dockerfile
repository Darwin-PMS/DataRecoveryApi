FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml turbo.json ./
COPY packages/*/package.json packages/
COPY apps/api/package.json apps/api/

RUN npm install -g pnpm@8
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build --filter=@datavault-pro/api

FROM base AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/packages ./packages

RUN pnpm install --prod --frozen-lockfile --filter=@datavault-pro/api

EXPOSE 4000

CMD ["dumb-init", "node", "dist/server.js"]

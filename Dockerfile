# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npm run prisma:generate

FROM node:24-alpine AS build
WORKDIR /app

RUN npm install -g npm@11.6.2

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS production
ENV NODE_ENV=production
ENV PORT=11000
WORKDIR /app

RUN npm install -g npm@11.6.2

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force

COPY --chown=nestjs:nodejs --from=build /app/dist ./dist
COPY --chown=nestjs:nodejs prisma ./prisma
COPY --chown=nestjs:nodejs prisma.config.ts ./prisma.config.ts
COPY --chown=nestjs:nodejs config/start-container.mjs ./config/start-container.mjs
COPY --chown=nestjs:nodejs console-web ./console-web
COPY --chown=nestjs:nodejs scripts/provision-console-pilot.mjs ./scripts/provision-console-pilot.mjs

USER nestjs
EXPOSE 11000

CMD ["node", "config/start-container.mjs"]

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
WORKDIR /app

RUN npm install -g npm@11.6.2

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

RUN npm prune --omit=dev && npm cache clean --force

USER nestjs
EXPOSE 3000

CMD ["npm", "run", "start:prod"]

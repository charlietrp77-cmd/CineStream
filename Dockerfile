# Stage 1: Build Monorepo
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /build

COPY package.json tsconfig.base.json ./
COPY packages/capacitor-native-player/package.json ./packages/capacitor-native-player/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

RUN npm install

COPY packages ./packages
RUN npm run build --workspaces

# Stage 2: Production Runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache wget sqlite-libs ffmpeg
WORKDIR /app

COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/server/package.json ./packages/server/
COPY --from=builder /build/packages/web/dist ./packages/web/dist
COPY --from=builder /build/packages/kodi-addon ./packages/kodi-addon

RUN mkdir -p /app/data /mnt/nas

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/cinestream.sqlite
ENV NAS_CACHE_PATH=/mnt/nas

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]


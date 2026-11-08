# Master Engineering & Architecture Specification: "CineStream"
**Self-Hosted Netflix-Grade Streaming, Multi-Profile, NAS Season Caching & Offline Platform**

---

## 0. Instructions for Antigravity (Autonomous AI Builder)
You are tasked with building the complete **CineStream** monorepo specified in this document.
- **No Placeholders or Mock Stubs:** Every file you create must contain complete, production-ready, strongly typed code. Never leave `// TODO` comments or empty functions.
- **Sequential Execution:** Follow the 6-phase build plan in **Section 9** in order, verifying TypeScript compilation (`tsc --noEmit`) at the end of each phase before moving to the next.
- **Single-Server Production Bundle:** In production, the Fastify backend (`packages/server`) serves both the `/api/*`, `/proxy/*`, `/ws/*` routes AND the compiled static frontend (`packages/web/dist`) on port `3000` so the entire platform runs cleanly inside a Portainer Stack alongside `aiostreams`.

---

## 1. System Overview & Core Objectives
Build a self-hosted, Netflix-grade media streaming platform (`CineStream`) inside a TypeScript monorepo that pairs with **AIOStreams** (`ghcr.io/viren070/aiostreams:latest`) and delivers:

1. **Portainer Stack Ready Deployment (`portainer-stack.yml`):**
   - Designed specifically for **Portainer Stacks** (Web Editor or Git Repository deployment) using Portainer-managed **Named Volumes** (`aiostreams_data`, `cinestream_data`) and an optional **NAS Media Volume/Bind Mount** (`/mnt/nas`) with declarative `${ENV}` variable injection.
   - Includes a multi-stage root `Dockerfile` and a GitHub Actions workflow (`.github/workflows/docker-publish.yml`) so Portainer can either pull a pre-built `ghcr.io` image or build directly from a Git repository.

2. **Multi-User Profile System ("Who's Watching?"):**
   - Full-screen animated Netflix profile gate on launch with avatar selection, Add/Edit/Delete profile modals, optional 4-digit PIN lock (navigable via Android TV D-Pad and iOS touch), and **Kids Profile mode** (automatically restricts TMDB searches, Top 10 rows, and New Releases to `PG` / `TV-Y7` certifications).
   - Complete isolation of **Continue Watching**, **Watchlist ("My List")**, **Watched Badges**, language/subtitle preferences, preferred NAS caching quality (`2160p` vs `1080p`), and `bingeGroup` auto-play state per `profileId`.
   - Optional per-profile `aiostreamsConfig` override (falls back to the global server AIOStreams config if left blank).

3. **NAS Background Season & Series Caching Engine ("Sonarr-Lite" Mode):**
   - Users can click **"Cache to NAS (Episode / Remaining Season / Entire Season / Entire Series)"** on any movie or TV series detail modal.
   - The backend resolves the best matching streams from AIOStreams (locking onto a consistent `bingeGroup`, resolution, and audio codec across all episodes of a season) and queues them in a persistent SQLite download worker pool.
   - Downloads execute via a multi-threaded parallel byte-range engine directly to the configured NAS path (`/mnt/nas/Movies/...` or `/mnt/nas/TV Shows/{Show Title}/Season {XX}/...`) with live WebSocket progress updates (`MB/s`, `%`, `ETA`, free NAS disk space) in the UI.
   - **Zero-Config Local Playback Priority:** Whenever any user clicks Play on a movie or episode that is already cached on the NAS, CineStream automatically serves the local NAS file at gigabit LAN speeds (`⚡ Cached on NAS` badge) with HTTP `206 Partial Content` byte-range streaming instead of querying external streams.

4. **Tablet & Mobile Offline Storage ("Download for Trip" Mode):**
   - On iOS (iPad/iPhone) and Android tablets, users can tap **"Download to Device"** on any movie, episode, or full season.
   - Downloads stream through the server's multi-threaded proxy (or directly from the NAS cache if already cached) into the device's native app sandbox storage (`file://.../Documents/OfflineMedia/`) and record metadata + base64 poster/backdrop artwork in a local IndexedDB offline ledger.
   - **Automatic Offline Mode:** When the tablet has no internet connection (`navigator.onLine === false` or `/api/health` unreachable), the app automatically switches into **Offline Mode** and plays local `file://` `.mkv`/`.mp4` files directly through the native **MPVKit (iOS)** or **ExoPlayer (Android)** engine with full Dolby Vision, Atmos, and embedded subtitles, syncing watch progress back to the server upon reconnection.

5. **60fps/120Hz Netflix UI, Instant Autocomplete & Speculative Pre-Fetching:**
   - Built with React 18 + Vite + TailwindCSS + `@noriginmedia/norigin-spatial-navigation` (Android TV D-pad navigation) and touch gestures (iOS/iPadOS).
   - Debounced instant TMDB multi-search (`less than 100ms`) and speculative background pre-fetching when a user hovers/focuses on a title for `greater than 1.2s`.

6. **Top 10 Rows & Verified Non-CAM New Releases:**
   - Interactive **"Top 10 in Country / Global"** row with giant SVG rank numbers (`1`–`10`) and live streaming provider filter pills (*All, Netflix, Apple TV+, Disney+, Prime Video, Max*).
   - **"Verified New Releases (Non-CAM)"** row powered by TMDB Digital/Physical release dates (`with_release_type=4|5`) cross-checked against AIOStreams to guarantee a verified `1080p`/`2160p` WEB-DL, BluRay, or Remux stream exists before displaying the poster.

7. **Multi-Threaded Sliding-Window HTTP Stream Proxy:**
   - High-performance Node.js/Fastify streaming proxy that accepts single-connection requests from ExoPlayer/MPV/AVPlayer and opens **6 to 8 concurrent byte-range (`Range`) connections** to Easynews/Debrid servers, stitching chunks inside a **64 MB RAM ring buffer** for instant playback and zero-buffer 4K Remux streaming.

8. **Hybrid Native Shells (Option B — Transparent WebView Sandwich):**
   - Capacitor 6 native wrappers for **Android TV** and **iOS** where the WebView turns transparent (`background: transparent`) during playback, revealing a hardware-accelerated native surface underneath (**AndroidX Media3 ExoPlayer** on Android TV, **MPVKit / AVPlayer** on iOS) with full **Dolby Vision, HDR10+, TrueHD Atmos, DTS-HD MA passthrough**, and embedded subtitle track switching.

---

## 2. Monorepo Directory Structure

Scaffold this exact workspace layout:

```text
cinestream/
├── portainer-stack.yml                 # Ready-to-deploy Portainer Stack Compose file
├── Dockerfile                          # Root multi-stage Dockerfile (builds Web + Server)
├── .github/workflows/
│   └── docker-publish.yml              # Publishes ghcr.io image for Portainer image pulls
├── .env.example                        # Portainer environment variables template
├── package.json                        # npm/pnpm workspaces root
├── tsconfig.base.json                  # Shared TypeScript compiler options
├── packages/
│   ├── server/                         # Self-hosted Backend + Proxy + NAS Downloader + SQLite
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # Fastify server + WebSocket hub + static Web UI + /api/health
│   │       ├── config.ts               # Typed environment configuration loader
│   │       ├── db/
│   │       │   ├── index.ts            # Better-SQLite3 singleton + WAL init + migrations + seed
│   │       │   └── schema.ts           # SQLite DDL & typed row interfaces
│   │       ├── services/
│   │       │   ├── tmdb.ts             # Cached TMDB client (Top 10, Autocomplete, Kids filter, Seasons)
│   │       │   ├── aiostreams.ts       # AIOStreams client + Speculative Pre-Fetcher + Non-CAM verifier
│   │       │   ├── proxy.ts            # Multi-Threaded Sliding-Window Byte-Range Proxy (RAM ring buffer)
│   │       │   └── nasDownloader.ts    # Multi-Threaded NAS Season/Series Queue Worker & Local File Server
│   │       └── routes/
│   │           ├── profiles.ts         # CRUD /api/profiles + PIN verification + Avatar presets
│   │           ├── catalog.ts          # /api/catalog/top10, /api/catalog/new-releases, /api/search
│   │           ├── streams.ts          # /api/streams/:type/:imdbId (prioritizes NAS cache, then proxy)
│   │           ├── nas.ts              # /api/nas/cache, /api/nas/jobs, /api/nas/stream/:id, /api/nas/disk
│   │           ├── progress.ts         # /api/progress & /api/mylist (scoped by X-Profile-Id header)
│   │           └── streamProxy.ts      # GET /proxy/stream?url=... (Multi-connection engine)
│   │
│   ├── web/                            # Netflix-style Frontend (React 18 + Vite + Tailwind)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── index.html                  # Fullscreen PWA + viewport-fit=cover meta tags
│   │   ├── capacitor.config.ts         # Points to self-hosted server URL with offline fallback
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── styles/global.css       # Fullscreen locks, GPU layer hints, overscroll-none
│   │       ├── types/api.ts            # Shared frontend/backend TypeScript interfaces
│   │       ├── store/
│   │       │   ├── useProfileStore.ts  # Active profile state, PIN lock, quick profile switcher
│   │       │   └── useOfflineStore.ts  # IndexedDB + Capacitor Filesystem manager for tablet downloads
│   │       ├── bridge/
│   │       │   ├── nativePlayer.ts     # Unified JS Bridge for ExoPlayer / MPV / file:// / HTML5 fallback
│   │       │   └── offlineDownloader.ts# Tablet background file downloader with pause/resume/progress
│   │       ├── hooks/
│   │       │   ├── useSpatialNav.ts    # Android TV D-Pad + iOS Touch unified navigation
│   │       │   └── usePreFetcher.ts    # Triggers background AIOStreams search on 1.2s hover
│   │       └── components/
│   │           ├── Navbar.tsx          # Glassmorphic top bar + InstantSearch trigger + Downloads badge + Profile switcher
│   │           ├── ProfileGate.tsx     # Netflix "Who's Watching?" screen + D-Pad PIN Pad + Editor
│   │           ├── HeroBillboard.tsx   # Dynamic 4K backdrop + ClearLogo + DV/Atmos/NAS badges
│   │           ├── TopTenRow.tsx       # Giant SVG 1-10 numbers + Service Filter Pills
│   │           ├── VirtualPosterRow.tsx# @tanstack/react-virtual 60fps row for New Releases/Continue/NAS
│   │           ├── MediaDetailModal.tsx# Episode picker + "Cache Season to NAS" + "Download to Tablet"
│   │           ├── DownloadsDrawer.tsx # Unified manager for NAS Cache jobs & Tablet Offline files
│   │           ├── InstantSearch.tsx   # 150ms debounced TMDB search grid + TV on-screen keyboard
│   │           └── PlayerOverlay.tsx   # Transparent HTML/CSS OSD over native video surface
│   │
│   └── capacitor-native-player/        # Custom Capacitor Plugin for Transparent Video & Offline Storage
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── definitions.ts          # TypeScript interface for NativeVideoPlayerPlugin & OfflineFetch
│       │   └── web.ts                  # HTML5 <video> + IndexedDB fallback for desktop browsers
│       ├── android/                    # Kotlin Media3 ExoPlayer + Background File Downloader
│       │   ├── build.gradle
│       │   └── src/main/java/com/cinestream/player/NativeVideoPlayerPlugin.kt
│       └── ios/                        # Swift MPVKit / AVPlayer + URLSession Background DownloadTask
│           └── Plugin/NativeVideoPlayerPlugin.swift
```

---

## 3. Portainer Stack & Container Infrastructure

### 3.1. `portainer-stack.yml`
Create this exact Compose file at the repository root so it can be pasted directly into **Portainer -> Stacks -> Add Stack**:

```yaml
services:
  aiostreams:
    image: ghcr.io/viren070/aiostreams:latest
    container_name: cinestream-aiostreams
    restart: unless-stopped
    ports:
      - "${AIOSTREAMS_PORT:-3001}:3000"
    environment:
      - SECRET_KEY=${AIOSTREAMS_SECRET_KEY}
      - ADDON_PASSWORD=${AIOSTREAMS_ADDON_PASSWORD:-}
      - BASE_URL=${AIOSTREAMS_BASE_URL:-http://aiostreams:3000}
    volumes:
      - aiostreams_data:/app/data
    networks:
      - cinestream_net
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/v1/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  cinestream:
    image: ${CINESTREAM_IMAGE:-ghcr.io/yourusername/cinestream:latest}
    build:
      context: .
      dockerfile: Dockerfile
    container_name: cinestream-app
    restart: unless-stopped
    ports:
      - "${CINESTREAM_PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_PATH=/app/data/cinestream.sqlite
      - NAS_CACHE_PATH=/mnt/nas
      - NAS_MAX_CONCURRENT_DOWNLOADS=${NAS_MAX_CONCURRENT_DOWNLOADS:-2}
      - NAS_THREADS_PER_DOWNLOAD=${NAS_THREADS_PER_DOWNLOAD:-6}
      - PUBLIC_SERVER_URL=${PUBLIC_SERVER_URL:-http://192.168.1.50:3000}
      - AIOSTREAMS_INTERNAL_URL=http://aiostreams:3000
      - AIOSTREAMS_USER_CONFIG=${AIOSTREAMS_USER_CONFIG}
      - TMDB_API_KEY=${TMDB_API_KEY}
      - DEFAULT_COUNTRY=${DEFAULT_COUNTRY:-ZA}
      - PROXY_CONNECTIONS=${PROXY_CONNECTIONS:-8}
      - PROXY_CHUNK_SIZE_MB=${PROXY_CHUNK_SIZE_MB:-8}
      - PROXY_READAHEAD_MB=${PROXY_READAHEAD_MB:-64}
    volumes:
      - cinestream_data:/app/data
      - ${NAS_HOST_PATH:-nas_media_cache}:/mnt/nas
    networks:
      - cinestream_net
    depends_on:
      - aiostreams
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  aiostreams_data:
    driver: local
  cinestream_data:
    driver: local
  nas_media_cache:
    driver: local

networks:
  cinestream_net:
    driver: bridge
```

### 3.2. Root Multi-Stage `Dockerfile`
Create a root `Dockerfile` that compiles `packages/capacitor-native-player`, `packages/web`, and `packages/server` in a builder stage and produces a clean `node:20-alpine` runtime image:

```dockerfile
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
RUN apk add --no-cache wget sqlite-libs
WORKDIR /app

COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/server/package.json ./packages/server/
COPY --from=builder /build/packages/web/dist ./packages/web/dist

RUN mkdir -p /app/data /mnt/nas

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/cinestream.sqlite
ENV NAS_CACHE_PATH=/mnt/nas

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
```

### 3.3. `.env.example`
```dotenv
# Portainer Environment Variables
CINESTREAM_PORT=3000
AIOSTREAMS_PORT=3001
PUBLIC_SERVER_URL=http://192.168.1.50:3000

# 64-character hex key for AIOStreams encryption (generate with: openssl rand -hex 32)
AIOSTREAMS_SECRET_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
AIOSTREAMS_ADDON_PASSWORD=
# The encrypted config string / UUID path generated after configuring AIOStreams at http://your-ip:3001
AIOSTREAMS_USER_CONFIG=

# TMDB API v3 Key (https://www.themoviedb.org/settings/api)
TMDB_API_KEY=your_tmdb_v3_api_key_here
DEFAULT_COUNTRY=ZA

# Host path to your NAS mount (e.g. /mnt/synology/media) or leave default named volume
NAS_HOST_PATH=nas_media_cache
NAS_MAX_CONCURRENT_DOWNLOADS=2
NAS_THREADS_PER_DOWNLOAD=6

# Multi-Threaded Live Streaming Proxy Tuning
PROXY_CONNECTIONS=8
PROXY_CHUNK_SIZE_MB=8
PROXY_READAHEAD_MB=64
```

---

## 4. Database Schema: Multi-Profile + NAS Caching (`packages/server/src/db/schema.ts`)

Use `better-sqlite3` at `process.env.DATABASE_PATH` with `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`. Initialize all tables on server boot and automatically seed a default `"Main"` and `"Kids"` profile if `SELECT COUNT(*) FROM profiles` is `0`:

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_id TEXT NOT NULL DEFAULT 'crimson-nebula',
  is_kids INTEGER NOT NULL DEFAULT 0,            -- 0 = Adult, 1 = Kids (PG / TV-Y7 filter)
  max_maturity_rating TEXT DEFAULT 'R',          -- 'G', 'PG', 'PG-13', 'R'
  pin_hash TEXT DEFAULT NULL,                    -- Optional 4-digit PIN (SHA-256 hex)
  preferred_audio_lang TEXT DEFAULT 'eng',
  preferred_subtitle_lang TEXT DEFAULT 'eng',
  preferred_nas_quality TEXT DEFAULT '2160p',    -- '2160p' | '1080p' default for NAS season caching
  auto_play_next INTEGER NOT NULL DEFAULT 1,
  auto_cache_season_on_watch INTEGER NOT NULL DEFAULT 0,
  aiostreams_config_override TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_progress (
  profile_id TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,                      -- 'movie' | 'tv'
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  episode_title TEXT DEFAULT NULL,
  poster_url TEXT,
  backdrop_url TEXT,
  clear_logo_url TEXT,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  binge_group TEXT DEFAULT NULL,
  last_stream_url TEXT DEFAULT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, imdb_id, season, episode),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS my_list (
  profile_id TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_url TEXT,
  backdrop_url TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, imdb_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nas_cache_items (
  id TEXT PRIMARY KEY,                           -- Format: "${imdbId}:${season}:${episode}" (0:0 for movies)
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,                      -- 'movie' | 'tv'
  title TEXT NOT NULL,                           -- Movie or Series Title
  episode_title TEXT DEFAULT NULL,
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  poster_url TEXT,
  backdrop_url TEXT,
  source_url TEXT NOT NULL,                      -- Raw upstream Easynews/Debrid URL
  source_headers_json TEXT DEFAULT '{}',
  binge_group TEXT DEFAULT NULL,
  quality_badge TEXT DEFAULT NULL,               -- e.g. '4K DV Atmos'
  file_path TEXT NOT NULL,                       -- Full path inside /mnt/nas/...
  file_size_bytes INTEGER DEFAULT 0,
  downloaded_bytes INTEGER DEFAULT 0,
  speed_bytes_per_sec INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',         -- 'queued' | 'downloading' | 'completed' | 'paused' | 'failed'
  error_message TEXT DEFAULT NULL,
  requested_by_profile_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verified_releases (
  imdb_id TEXT PRIMARY KEY,
  tmdb_id INTEGER NOT NULL,
  has_non_cam_stream INTEGER NOT NULL DEFAULT 0,
  best_quality_badge TEXT DEFAULT NULL,          -- e.g. '4K DV', '4K HDR', '1080p WEB-DL'
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tmdb_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

---

## 5. Backend Engines & API Specification (`packages/server`)

### 5.1. Multi-Threaded Sliding-Window Byte-Range Proxy (`src/services/proxy.ts`)
This service eliminates single-connection buffering on Easynews and Debrid HTTP streams for ExoPlayer, MPV, and Tablet Offline Downloads.

**Implementation Details:**
1. **Route:** `GET /proxy/stream?url=<base64url>&headers=<base64url>`
2. **Upstream Metadata Cache:**
   - Maintain an in-memory `Map<string, { totalSize: number; contentType: string; acceptsRanges: boolean; expiresAt: number }>` (TTL 30 minutes).
   - If not cached, send a `GET` request with `Range: bytes=0-1` to the upstream URL using an `undici.Agent({ connections: 32, keepAliveTimeout: 30000 })`. Parse the `Content-Range: bytes 0-1/<totalSize>` header to obtain the exact `totalSize` and `contentType`.
3. **Range Parsing & Response Headers:**
   - Parse the incoming `Range` header from ExoPlayer/MPV (e.g., `Range: bytes=0-` or `Range: bytes=64281920-`).
   - Compute `startByte` and `endByte` (defaulting `endByte` to `totalSize - 1`).
   - Immediately write response status `206 Partial Content` with headers:
     ```http
     Accept-Ranges: bytes
     Content-Type: video/x-matroska (or upstream contentType)
     Content-Length: ${endByte - startByte + 1}
     Content-Range: bytes ${startByte}-${endByte}/${totalSize}
     Connection: keep-alive
     ```
4. **Small Metadata Tail-Seek Fast Path:**
   - When ExoPlayer opens an `.mkv` file, it often seeks to the final 1–2 MB of the file to read the Matroska `Cues` index table before jumping back to byte `0`.
   - If `(endByte - startByte + 1) <= 2 * 1024 * 1024` (2 MB) or `startByte > totalSize - 4 * 1024 * 1024`, bypass the multi-worker ring buffer and directly pipe a single upstream `Range: bytes=${startByte}-${endByte}` stream for sub-50ms seek responsiveness.
5. **Sliding-Window Parallel Worker Pool (For Playback & Large Ranges):**
   - Constants: `CHUNK_SIZE = config.proxyChunkSizeMb * 1024 * 1024` (default 8 MB), `MAX_WORKERS = config.proxyConnections` (default 8), `MAX_READAHEAD_CHUNKS = Math.ceil(config.proxyReadaheadMb / config.proxyChunkSizeMb)` (default 8 chunks = 64 MB).
   - Divide the requested range `[startByte, endByte]` into sequential chunks indexed `0, 1, 2, ... N`.
   - **Chunk 0 Direct Streaming (Instant Time-To-First-Byte):** Worker 0 requests `Chunk 0` and streams its body chunks directly to `reply.raw` as they arrive over the network so the video player receives the MKV header within milliseconds.
   - **Chunks 1..N Parallel Prefetching:** Simultaneously, Workers `1` through `MAX_WORKERS - 1` fetch upcoming chunks in parallel (`nextChunkToAssign <= currentFlushIndex + MAX_READAHEAD_CHUNKS`), storing their `Uint8Array` buffers in `completedChunks: Map<number, Uint8Array>`.
   - **Ordered Ring-Buffer Flusher:** As soon as `Chunk[currentFlushIndex]` is complete in `completedChunks`, write it to `reply.raw` (respecting Node stream backpressure: if `reply.raw.write(buf)` returns `false`, `await new Promise(res => reply.raw.once('drain', res))`), delete `Chunk[currentFlushIndex]` from the map to free RAM immediately, increment `currentFlushIndex`, and wake up idle workers to fetch the next chunk in the window.
   - **Clean Abort on Seek/Disconnect:** Listen to `request.raw.on('close', () => masterAbortController.abort())` so all active upstream `fetch` calls terminate and clear memory the instant the user scrubs the timeline or stops playback.

### 5.2. NAS Background Season & Series Caching Engine (`src/services/nasDownloader.ts` & `src/routes/nas.ts`)
1. **`POST /api/nas/cache`:**
   - Body:
     ```typescript
     interface NasCacheRequest {
       imdbId: string;
       tmdbId: number;
       mediaType: 'movie' | 'tv';
       scope: 'movie' | 'episode' | 'remaining_season' | 'season' | 'all_seasons';
       seasonNumber?: number;
       episodeNumber?: number;
       preferredQuality?: '2160p' | '1080p';
       preferredBingeGroup?: string;
     }
     ```
   - **Episode Enumeration:**
     - For `movie`: single item `(season: 0, episode: 0)`.
     - For `episode`: single item `(seasonNumber, episodeNumber)`.
     - For `season` or `remaining_season`: fetch TMDB `/3/tv/${tmdbId}/season/${seasonNumber}`, filter to aired episodes (`air_date <= today`), and if `remaining_season`, filter `episode_number >= episodeNumber`.
     - For `all_seasons`: fetch `/3/tv/${tmdbId}`, filter valid seasons (`season_number > 0`), and enumerate all aired episodes across all seasons.
   - **AIOStreams Resolution & `bingeGroup` Locking:**
     - Query AIOStreams for the first item in the list. Select the best non-CAM stream matching `preferredQuality` (or `preferredBingeGroup` if provided).
     - Record `lockedBingeGroup = selectedStream.behaviorHints?.bingeGroup`.
     - For all subsequent episodes in the batch, query AIOStreams and select the stream whose `behaviorHints?.bingeGroup === lockedBingeGroup` (or fallback to highest score matching `preferredQuality`).
     - Construct clean, Plex/Jellyfin-compatible target paths inside `/mnt/nas`:
       - Movies: `/mnt/nas/Movies/${sanitize(title)} (${year})/${sanitize(title)} (${year}) [${qualityBadge}].mkv`
       - TV Series: `/mnt/nas/TV Shows/${sanitize(showTitle)}/Season ${pad2(season)}/${sanitize(showTitle)} - S${pad2(season)}E${pad2(episode)} - ${sanitize(epTitle)} [${qualityBadge}].mkv`
     - Insert rows into `nas_cache_items` with `status = 'queued'` and trigger `nasDownloader.processQueue()`.
2. **Multi-Threaded NAS File Writer (`src/services/nasDownloader.ts`):**
   - Processes up to `NAS_MAX_CONCURRENT_DOWNLOADS` (default `2`) items concurrently.
   - Creates parent directories (`fs.mkdir(dir, { recursive: true })`) and opens `${file_path}.part`.
   - Divides the remote file into `16 MB` segments and spawns `NAS_THREADS_PER_DOWNLOAD` (default `6`) concurrent workers that fetch byte ranges and write directly to the exact offset in `${file_path}.part` using `fileHandle.write(buffer, 0, buffer.length, segmentStartOffset)`.
   - Broadcasts real-time JSON state over WebSocket (`GET /ws/downloads`) every `1000ms` and updates `nas_cache_items`.
   - On completion, closes the file handle, renames `${file_path}.part` -> `${file_path}`, and updates `status = 'completed'`.
   - Supports Pause (`POST /api/nas/jobs/:id/pause`), Resume (`POST /api/nas/jobs/:id/resume`), and Delete (`DELETE /api/nas/jobs/:id` — removes DB row and deletes file from `/mnt/nas`).
   - Exposes `GET /api/nas/disk` using `await fs.promises.statfs(config.nasCachePath)` to return `{ totalBytes, freeBytes, usedBytes }`.
3. **Local NAS Byte-Range Streamer (`GET /api/nas/stream/:id`):**
   - Looks up `nas_cache_items` by `id`. Verifies `status === 'completed'` and file existence on `/mnt/nas`.
   - Parses incoming `Range` header and streams the file directly from the NAS disk with `HTTP 206 Partial Content` and `fs.createReadStream(item.file_path, { start, end, highWaterMark: 2 * 1024 * 1024 })`.

### 5.3. AIOStreams Integration & Custom Badge Parser (`src/services/aiostreams.ts` & `src/routes/streams.ts`)
1. **AIOStreams Request URL:**
   - Determine active config: `profile?.aiostreams_config_override || config.aiostreamsUserConfig`.
   - Query `${config.aiostreamsInternalUrl}/${activeConfig}/stream/${type}/${id}.json`.
2. **Badge & Metadata Extraction:**
   - Parse each returned stream's `name`, `description`, `title`, and `behaviorHints.filename` using regex detection to produce a structured `StreamBadges` object:
     ```typescript
     export interface StreamBadges {
       resolution: '4K' | '1080p' | '720p' | 'SD';
       dolbyVision: boolean;      // /\b(DV|Dolby\s*Vision|DoVi)\b/i
       hdr10Plus: boolean;        // /\b(HDR10\+|HDR10Plus)\b/i
       hdr: boolean;              // /\b(HDR|HDR10)\b/i
       atmos: boolean;            // /\b(Atmos)\b/i
       trueHd: boolean;           // /\b(TrueHD)\b/i
       dtsHd: boolean;            // /\b(DTS-HD|DTS:X|DTS-MA)\b/i
       remux: boolean;            // /\b(REMUX)\b/i
       source: string;            // Extracted provider e.g. 'Easynews', 'Real-Debrid', 'TorBox', 'Usenet'
       sizeText: string;          // e.g. '62.4 GB'
       isNasCached: boolean;
     }
     ```
3. **Strict CAM Exclusion Filter:**
   - Reject any stream matching `/\b(CAM|HDCAM|CAMRIP|TS|TELESYNC|HDTS|TC|TELECINE|SCR|SCREENER|WORKPRINT)\b/i`.
4. **Priority Ordering (`GET /api/streams/:type/:id`):**
   - First, check `nas_cache_items` for `id`. If `status === 'completed'`, inject the local NAS stream (`${config.publicServerUrl}/api/nas/stream/${encodeURIComponent(id)}`) at index `0` with `isNasCached: true`.
   - Next, rewrite all AIOStreams URLs to route through the multi-threaded proxy:
     `${config.publicServerUrl}/proxy/stream?url=${base64url(stream.url)}&headers=${base64url(JSON.stringify(headers))}`

### 5.4. TMDB Catalogs: Top 10 by Provider/Country, Verified New Releases & Instant Search (`src/services/tmdb.ts`)
1. **Top 10 Endpoint (`GET /api/catalog/top10?region=ZA&provider=all&type=movie|tv`):**
   - Provider ID mapping:
     - `all`: no provider filter (if `region === 'GLOBAL'`, use `/3/trending/${type}/day`; otherwise use `/3/discover/${type}?watch_region=${region}&sort_by=popularity.desc`)
     - `netflix`: `with_watch_providers=8`
     - `apple`: `with_watch_providers=350`
     - `disney`: `with_watch_providers=337`
     - `prime`: `with_watch_providers=9`
     - `max`: `with_watch_providers=1899`
   - If the active profile has `is_kids === 1`, append `&certification_country=US&certification.lte=PG&without_genres=27,53,80`.
   - For the top 10 items, enrich in parallel with `/3/${type}/${id}?append_to_response=images,external_ids,videos,content_ratings,release_dates` to attach:
     - `rank` (`1` through `10`)
     - `imdbId`
     - `clearLogoUrl` (first English or null-language logo from `images.logos`, formatted as `https://image.tmdb.org/t/p/w500${file_path}`)
     - `backdropUrl` (`https://image.tmdb.org/t/p/w1280${backdrop_path}`)
     - `posterUrl` (`https://image.tmdb.org/t/p/w500${poster_path}`)
     - `isNasCached` (boolean lookup against `nas_cache_items`).
2. **Verified Non-CAM New Releases (`GET /api/catalog/new-releases`):**
   - Query TMDB `/3/discover/movie?with_release_type=4|5&primary_release_date.lte=${TODAY}&sort_by=primary_release_date.desc&vote_count.gte=15`.
   - For each candidate movie, resolve its `imdbId` and check `verified_releases` in SQLite (valid for 4 hours).
   - If not yet verified (or expired), query AIOStreams for `movie/${imdbId}`, apply the non-CAM filter, and verify that at least one stream matches `/(2160p|1080p)/i`. Store `has_non_cam_stream = 1` and `best_quality_badge` (e.g. `'4K DV'`, `'4K HDR'`, `'1080p'`) in `verified_releases`.
   - Return only verified non-CAM movies to the frontend.

---

## 6. Frontend Specification (`packages/web`)

### 6.1. Global Fullscreen Lock & Transparent Video Mode (`index.html` & `src/styles/global.css`)
- **`index.html`:**
  ```html
  <!DOCTYPE html>
  <html lang="en" class="dark">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="theme-color" content="#0a0a0a" />
      <title>CineStream</title>
    </head>
    <body class="bg-[#0a0a0a] text-white antialiased selection:bg-red-600">
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```
- **`src/styles/global.css`:**
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  html, body, #root {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: #0a0a0a;
    overscroll-behavior: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Option B Transparent WebView Sandwich Mode */
  html.video-playing,
  html.video-playing body,
  html.video-playing #root {
    background: transparent !important;
    background-color: transparent !important;
  }

  .gpu-layer {
    will-change: transform, opacity;
    transform: translateZ(0);
    backface-visibility: hidden;
  }
  ```

### 6.2. Core UI Views & Components
1. **`ProfileGate.tsx` ("Who's Watching?"):**
   - Displays all profiles from `GET /api/profiles` with distinct SVG/gradient avatars, `"KIDS"` corner ribbon when `is_kids === 1`, and a lock icon when `hasPin === true`.
   - Includes an interactive D-Pad & Touch **4-Digit PIN Modal** (`POST /api/profiles/:id/verify-pin`) and an **Add / Edit Profile Modal** allowing users to configure Name, Avatar, Kids Mode, 4-Digit PIN, Default Audio/Subtitle Language, Preferred NAS Quality (`4K` vs `1080p`), and an optional custom AIOStreams Manifest Config string.
2. **`TopTenRow.tsx` (Netflix Top 10 Carousel):**
   - Header includes interactive filter pills:
     - Streaming Service Pills: `[ All Services ]`, `[ Netflix ]`, `[ Apple TV+ ]`, `[ Disney+ ]`, `[ Prime Video ]`, `[ Max ]`
     - Region Selector Pill: `[ Country (ZA/US/UK) ]` / `[ 🌍 Global ]`
     - Media Type Toggle: `[ Movies ]` / `[ TV Series ]`
   - Each card renders a giant stylized SVG rank numeral (`1`–`10`) with metallic stroke (`stroke="#666" strokeWidth="5" fill="#0d0d0d"`) positioned behind the left edge of the poster (`-left-8 z-0`) and the poster (`z-10`) shifting smoothly on D-pad focus (`scale-105 ring-2 ring-white`).
3. **`MediaDetailModal.tsx` (Streams, NAS Caching & Tablet Offline Downloads):**
   - Opens when clicking any movie or TV series card.
   - Displays 4K backdrop, ClearLogo, synopsis, cast, release status pill (`🟢 Available in 4K DV / Atmos` or `⚡ Cached on NAS`), and stream selector list.
   - **Action Buttons Bar:**
     - `▶ Play Best Stream` (immediately launches `PlayerOverlay` with the #1 stream).
     - `⚡ Cache to NAS` (for Movies: queues movie to NAS; for TV Series: opens a dropdown menu with **Cache Current Episode**, **Cache Remaining Season**, **Cache Entire Season X**, **Cache All Seasons**).
     - `📲 Download to Device` (transfers movie or selected episode/season to local tablet offline storage via `offlineDownloader.ts`).
     - `+ My List` (toggles item in active profile's `my_list`).
4. **`DownloadsDrawer.tsx` (NAS & Offline Storage Command Center):**
   - Slide-over drawer with two tabs:
     - **Tab 1: 🖥️ NAS Storage Cache:** Displays `/mnt/nas` free/total disk space bar (`GET /api/nas/disk`), active downloads with live WebSocket progress bars, download speed (`MB/s`), Pause/Resume/Delete buttons, and completed NAS library items.
     - **Tab 2: 📱 On This Device (Offline Mode):** Displays movies and episodes stored in local device storage (`useOfflineStore`), with one-tap Offline Play and Delete buttons.
5. **`InstantSearch.tsx`:**
   - Full-screen overlay with both native keyboard input and an Android TV D-Pad on-screen keyboard grid (`A–Z`, `0–9`, `Space`, `Backspace`).
   - Debounces input by `150ms` against `GET /api/search?q=...` and automatically triggers `POST /api/streams/prefetch` for the #1 search result after `800ms`.
6. **`PlayerOverlay.tsx`:**
   - Activated when playing any stream. Adds `html.video-playing` (`background: transparent`) so the native video surface at Z-Index `0` shows through.
   - Renders a sleek auto-hiding Netflix OSD (fades out after 4 seconds of inactivity; wakes on D-Pad press or screen tap):
     - Top bar: Back button, Title, Episode Title, active badges (`Dolby Vision`, `Atmos`, `⚡ NAS Direct`, or `📱 Offline File`).
     - Center: Play/Pause, `-10s` / `+10s` seek buttons.
     - Bottom bar: Interactive timeline scrubber, current/total time, **Audio Track Switcher Modal**, **Subtitle Track Switcher Modal**, and **"Next Episode"** button (auto-triggers during the last 30 seconds of an episode using matching `bingeGroup`).

---

## 7. Native Hybrid Plugin Specification (`packages/capacitor-native-player`)

### 7.1. TypeScript Plugin Interface (`src/definitions.ts`)
```typescript
import type { PluginListenerHandle } from '@capacitor/core';

export interface PlayOptions {
  url: string;                    // http(s):// proxy/NAS stream OR file:// local offline path
  title: string;
  subtitle?: string;
  startPositionMs?: number;
  headers?: Record<string, string>;
  bingeGroup?: string;
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
}

export interface TrackInfo {
  id: string;
  language: string;
  label: string;
  codec: string;
  selected: boolean;
}

export interface OfflineDownloadOptions {
  downloadId: string;
  url: string;
  filename: string;
  headers?: Record<string, string>;
  title: string;
}

export interface OfflineDownloadProgress {
  downloadId: string;
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  localFileUri?: string;
  error?: string;
}

export interface NativeVideoPlayerPlugin {
  loadAndPlay(options: PlayOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;
  stop(): Promise<void>;
  getTracks(): Promise<{ audioTracks: TrackInfo[]; subtitleTracks: TrackInfo[] }>;
  setAudioTrack(options: { trackId: string }): Promise<void>;
  setSubtitleTrack(options: { trackId: string | null }): Promise<void>;

  // Offline Tablet Storage API
  startOfflineDownload(options: OfflineDownloadOptions): Promise<{ localFileUri: string }>;
  pauseOfflineDownload(options: { downloadId: string }): Promise<void>;
  resumeOfflineDownload(options: { downloadId: string }): Promise<void>;
  removeOfflineDownload(options: { downloadId: string; localFileUri?: string }): Promise<void>;
  getDeviceStorageInfo(): Promise<{ freeBytes: number; totalBytes: number }>;

  addListener(
    eventName: 'timeUpdate' | 'stateChange' | 'tracksLoaded' | 'playbackEnded' | 'error' | 'offlineDownloadProgress',
    listenerFunc: (data: any) => void
  ): Promise<PluginListenerHandle>;
}
```

### 7.2. Web Fallback Implementation (`src/web.ts`)
When running in a desktop web browser (outside Capacitor Android/iOS), `NativeVideoPlayerWeb` dynamically creates an HTML5 `<video>` element positioned at `position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: -1; background: #000; object-fit: contain;` behind the transparent UI so the exact same `<PlayerOverlay/>` controls work seamlessly on desktop browsers too.

### 7.3. Android TV & Tablet Native Implementation (`NativeVideoPlayerPlugin.kt`)
- Uses `androidx.media3:media3-exoplayer:1.4.1`, `androidx.media3:media3-exoplayer-hls:1.4.1`, and `androidx.media3:media3-ui:1.4.1`.
- Inserts a hardware `SurfaceView` at index `0` of `activity.findViewById<ViewGroup>(android.R.id.content)` and sets `bridge.webView.setBackgroundColor(Color.TRANSPARENT)`.
- Configures `DefaultRenderersFactory(context).setExtensionRendererMode(EXTENSION_RENDERER_MODE_PREFER)` and `DefaultTrackSelector` with `setTunnelingEnabled(true)` for hardware Dolby Vision and HDMI eARC passthrough (TrueHD Atmos, E-AC3 Atmos, DTS-HD MA).
- Supports both `http(s)://` (`DefaultHttpDataSource.Factory`) and local offline `file://` (`FileDataSource.Factory`) URIs.
- Implements `startOfflineDownload` using a coroutine-backed chunked file downloader writing to `context.getExternalFilesDir("OfflineMedia")` and emitting `offlineDownloadProgress` events to JS.

### 7.4. iOS & iPadOS Native Implementation (`NativeVideoPlayerPlugin.swift`)
- Sets `webView.isOpaque = false`, `webView.backgroundColor = .clear`, and `webView.scrollView.backgroundColor = .clear`, inserting `videoContainerView` at index `0` below `webView`.
- Uses `AVPlayerLayer` for `.mp4`/`.m3u8` streams (Dolby Vision EDR + Spatial Audio Atmos) and `MPVKit` (`libmpv` Metal layer with `vo=gpu-next`, `hwdec=videotoolbox`, `target-colorspace-hint=yes`) for `.mkv` streams and local `file://` `.mkv` offline downloads.
- Implements `startOfflineDownload` using `URLSession` background download tasks saving to `Documents/OfflineMedia` with `isExcludedFromBackup = true`.

---

## 8. Portainer Deployment Guide (Quick Reference)
1. **Deploy Stack in Portainer:**
   - Open Portainer -> **Stacks** -> **Add Stack**.
   - Paste `portainer-stack.yml` (or link your Git repository).
   - Add the environment variables from `.env.example` (`TMDB_API_KEY`, `AIOSTREAMS_SECRET_KEY`, `PUBLIC_SERVER_URL`, `NAS_HOST_PATH`).
2. **Initialize AIOStreams:**
   - Open `http://<your-server-ip>:3001/stremio/configure`.
   - Add your Easynews, Real-Debrid, TorBox, or Usenet credentials, exclude `CAM, TS, TC, SCR`, and copy the generated configuration UUID/manifest token into `AIOSTREAMS_USER_CONFIG` in Portainer.
3. **Open CineStream:**
   - Navigate to `http://<your-server-ip>:3000` (or launch the Capacitor Android TV / iOS app pointed to that URL).

---

## 9. Six-Phase Execution Checklist for Antigravity

Execute these 6 phases in order:

- [ ] **Phase 1: Workspace, Docker/Portainer Config & SQLite Database**
  - Create root `package.json`, `tsconfig.base.json`, `Dockerfile`, `portainer-stack.yml`, `.env.example`, and `.github/workflows/docker-publish.yml`.
  - Create `packages/server/package.json`, `tsconfig.json`, `src/config.ts`, `src/db/schema.ts`, and `src/db/index.ts` (including automatic table creation and seeding default `"Main"` and `"Kids"` profiles).
- [ ] **Phase 2: Backend Engines (Multi-Threaded Proxy, NAS Season Downloader, TMDB & AIOStreams)**
  - Implement `src/services/proxy.ts` (8-connection sliding-window byte-range proxy with 64 MB RAM ring buffer and tail-seek fast path).
  - Implement `src/services/nasDownloader.ts` (multi-threaded background queue worker writing `.part` files to `/mnt/nas`, WebSocket broadcaster, and `statfs` disk space check).
  - Implement `src/services/aiostreams.ts` (stream resolver, badge parser, CAM filter, speculative pre-fetcher) and `src/services/tmdb.ts` (Top 10 by provider/country, Verified Non-CAM New Releases, Instant Search, Kids rating filter).
- [ ] **Phase 3: Backend Fastify Routes & WebSocket Hub**
  - Implement `src/routes/profiles.ts`, `src/routes/catalog.ts`, `src/routes/streams.ts`, `src/routes/nas.ts`, `src/routes/progress.ts`, `src/routes/streamProxy.ts`, and `src/index.ts`.
  - Run `tsc --noEmit` in `packages/server` and fix any type errors.
- [ ] **Phase 4: Capacitor Native Video & Offline Downloader Plugin**
  - Create `packages/capacitor-native-player` with `src/definitions.ts`, `src/web.ts` (desktop HTML5 video fallback), `src/index.ts`, Android Kotlin `NativeVideoPlayerPlugin.kt` (Media3 ExoPlayer + transparent WebView + offline file downloader), and iOS Swift `NativeVideoPlayerPlugin.swift` (AVPlayer/MPVKit + transparent WKWebView + background downloader).
- [ ] **Phase 5: Frontend Stores, Bridges & Spatial Navigation Hooks**
  - Scaffold `packages/web` with Vite, React 18, TailwindCSS, `@noriginmedia/norigin-spatial-navigation`, and `@tanstack/react-virtual`.
  - Implement `src/types/api.ts`, `src/store/useProfileStore.ts`, `src/store/useOfflineStore.ts` (IndexedDB offline ledger + base64 artwork caching + automatic offline detection), `src/bridge/nativePlayer.ts`, `src/bridge/offlineDownloader.ts`, `src/hooks/useSpatialNav.ts`, and `src/hooks/usePreFetcher.ts`.
- [ ] **Phase 6: Netflix UI Components & Full Monorepo Build Verification**
  - Implement `ProfileGate.tsx`, `Navbar.tsx`, `HeroBillboard.tsx`, `TopTenRow.tsx`, `VirtualPosterRow.tsx`, `MediaDetailModal.tsx`, `DownloadsDrawer.tsx`, `InstantSearch.tsx`, `PlayerOverlay.tsx`, and `App.tsx`.
  - Run `npm run build --workspaces` across the entire monorepo and verify zero TypeScript or Vite bundling errors.
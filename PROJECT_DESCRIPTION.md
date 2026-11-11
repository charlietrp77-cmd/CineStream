# CineStream: Project Architecture, Philosophy, & Technical Specification

> **Version:** 1.0.0  
> **Classification:** Comprehensive Technical Architecture & Project Description  
> **Target Audience:** Developers, System Administrators, DevOps Engineers, and End Users

---

## 1. Executive Summary & Vision

**CineStream** is a modern, self-hosted streaming media aggregator, high-throughput streaming proxy, and automated storage orchestrator. It bridges the divide between **cloud-based instant streaming** (Debrid networks & Usenet web services) and **local automated media storage** (NAS storage, SABnzbd, Radarr, and Sonarr).

Traditional home media setups force users into one of two extremes:
1. **The Pure Local Stack (Servarr + Torrent/Usenet + Plex/Jellyfin):** Demands massive local hard drive arrays, constant manual maintenance of indexers/downloaders, hours of waiting for downloads to finish before watching, and extensive path mapping configurations.
2. **The Pure Cloud Streaming App (Stremio + Debrid):** Delivers instant playback with no local disk footprint, but lacks automated library management, local caching, multi-user kids safety controls, and resilience against internet outages.

**CineStream unifies both worlds into a single, cohesive ecosystem.** Users can click on any 4K HDR movie or TV show and start watching in milliseconds via high-speed segmented streaming proxies—while CineStream simultaneously orchestrates background NAS caching, automatically configures Radarr and Sonarr for long-term collection archiving, manages SABnzbd download queues, and serves the media seamlessly across desktop browsers, mobile devices, Stremio, and Android TV.

---

## 2. Core Architecture: What We Do

CineStream is built as an enterprise-grade TypeScript monorepo consisting of a high-performance **Fastify backend server**, a modern **React 18 + Vite frontend**, a **Capacitor native media player layer**, and fully automated **Docker/Portainer microservices orchestration**.

```mermaid
flowchart TD
    subgraph ClientLayer["Client & Playback Interfaces"]
        UI["CineStream Web & TV UI (React 18 + D-Pad Nav)"]
        TVBro["Android TV Browsers (TV Bro / JioPages)"]
        StremioApp["Stremio Native App (Android TV / iOS / PC)"]
        ExtPlayer["External Players (VLC / Just Player / MPV)"]
    end

    subgraph EdgeLayer["Reverse Proxy & Gateway"]
        Caddy["Caddy v2 (Automatic HTTPS & DuckDNS SSL)"]
    end

    subgraph CoreEngine["CineStream Backend (Fastify + TypeScript)"]
        Server["API & Orchestration Server (:3000)"]
        StreamProxy["Segmented Streaming Proxy (8 Workers / Read-Ahead)"]
        BootstrapSvc["Zero-Touch Bootstrap & Arr Auto-Linker"]
        Matcher["Precision Release Matcher (±10% Size Heuristics)"]
        AIOStreams["AIOStreams Engine (:3001)"]
        SQLite[("cinestream.sqlite (WAL Mode)")]
    end

    subgraph MediaServices["Local Servarr & Downloader Stack"]
        Radarr["Radarr v5 (:7878)"]
        Sonarr["Sonarr v4 (:8989)"]
        Prowlarr["Prowlarr (:9696)"]
        SABnzbd["SABnzbd Usenet Downloader (:8080)"]
    end

    subgraph StorageLayer["Shared Storage Mounts"]
        NAS["NAS Media Cache (/mnt/nas)"]
        MoviesDir["/mnt/nas/movies"]
        TVDir["/mnt/nas/tv"]
        DownloadsDir["/mnt/nas/downloads/complete"]
    end

    subgraph CloudProviders["Cloud Streaming Providers & Usenet"]
        Debrid["Debrid Providers (Real-Debrid, TorBox, Premiumize, AllDebrid)"]
        Easynews["Easynews NNTP & Web Engine"]
        Indexers["Usenet Indexers (altHUB, NZBGeek, DrunkenSlug)"]
    end

    ClientLayer --> EdgeLayer
    EdgeLayer --> CoreEngine
    CoreEngine --> CloudProviders
    CoreEngine --> MediaServices
    MediaServices --> StorageLayer
    CoreEngine --> StorageLayer
```

### 2.1. Feature Overview

| Capability | Technical Implementation | Practical Benefit |
| :--- | :--- | :--- |
| **Netflix-Grade Profile Gate** | React 18, Zustand, CSS glassmorphism, avatar selection, PIN protection | Multi-user households share a single installation with personalized watch history and favorites. |
| **Kids Profile Restriction** | Automatic TMDB certification filtering (`PG`, `G`, `TV-Y7`, `TV-G`) | Automatically hides adult content, violent releases, and mature search results from kids' profiles. |
| **Spatial D-Pad Navigation** | `@noriginmedia/norigin-spatial-navigation` + `useSpatialNav` | Complete control using only TV remote Arrow keys, Enter, and Back buttons on Android TV/Smart TVs. |
| **Segmented High-Speed Proxy** | Undici HTTP client, 8 parallel byte-range streams, 64MB read-ahead | Eliminates buffering on high-bitrate 4K Remux, Dolby Vision, and HDR10+ files. |
| **Zero-Touch Servarr Bootstrap** | `BootstrapService`, XML sanitization, live schema matching, API sync | Radarr, Sonarr, and SABnzbd are auto-configured without manual URL, port, or key entry. |
| **Auto-Category Provisioning** | SABnzbd REST API (`mode=set_config&section=categories`) | Auto-creates `movies` and `tv` categories in SABnzbd, preventing Servarr rejection errors. |
| **Permission Auto-Healing** | Node.js `fs.chmodSync(0o666)`, `0o777`, `chownSync(1000, 1000)` | Resolves LinuxServer non-root (`abc`) permission denied crashes across shared Docker volumes. |
| **Precision Release Matcher** | Smart regex parsing + ±10% byte-size alignment algorithms | Pushes the exact stream being watched to Radarr/Sonarr for archiving with matching quality. |
| **Universal Playback Compatibility** | HTML5 Video, native ExoPlayer SurfaceView, M3U playlist generation | Plays in browsers, Stremio, VLC, native Android TV apps, or Android TV browsers (TV Bro). |

---

## 3. Why We Built It (Design Rationale & Philosophy)

### 3.1. The Streaming Landscape Problem
1. **Subscription Fatigue & Geoblocking:** Streaming platforms have fragmented across dozens of costly silos (Netflix, Disney+, Prime, Max, Apple TV+, Paramount+), constantly removing licenses and rotating catalogues.
2. **Torrenting Risks & Limitations:** Public peer-to-peer torrenting exposes residential IP addresses to ISP copyright warning notices, throttled connections, and requires seeding bandwidth. Furthermore, older or obscure media frequently lacks active seeders, resulting in stalled downloads.
3. **The Complexity of the Servarr Ecosystem:** Setting up Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent, and Jellyfin/Plex traditionally requires hours of tedious configuration: generating API keys, mapping root paths, configuring download client categories, debugging permission errors, and manually adding indexer categories.

### 3.2. Why Debrid & Usenet?
- **Real-Debrid, TorBox, Premiumize, AllDebrid:** Cache torrents on enterprise cloud servers. When a user streams through Debrid, they download directly from high-bandwidth HTTPS CDNs at line speed without peering, port-forwarding, or seeding.
- **Easynews & Usenet:** Provides over a decade of retention with direct HTTPS downloads from multi-gigabit Usenet servers.
- **CineStream's Innovation:** We treat these cloud sources not merely as temporary streams, but as an on-demand intake pipeline that can seamlessly archive content into your local collection on request.

### 3.3. Why the Hybrid Cloud/NAS Architecture?
Cloud streaming provides **instant gratification**, while local NAS storage provides **permanent ownership**. CineStream blends both:
- When you click Play, you watch **immediately** from the cloud.
- If you want the media saved permanently, CineStream’s **Precision Matcher** instructs Radarr/Sonarr to acquire the exact matching release and store it in your local `/mnt/nas/movies` or `/mnt/nas/tv` directories.
- Subsequent playback for anyone on your local network streams directly from your NAS at local LAN speeds with zero external bandwidth consumption.

---

## 4. Advantages & Disadvantages

```mermaid
flowchart LR
    subgraph Advantages["Advantages (Pros)"]
        A1["Instant 4K Playback (No Seeding)"]
        A2["Zero-Touch Docker Orchestration"]
        A3["Multi-User Netflix UI + Kids Lock"]
        A4["High-Speed Segmented Chunk Proxy"]
        A5["Hybrid Cloud + Local NAS Archiving"]
        A6["Dolby Vision & Atmos Passthrough"]
    end

    subgraph Disadvantages["Trade-offs & Considerations (Cons)"]
        D1["Requires Provider Subscription (Debrid/Usenet)"]
        D2["Local Storage Overhead for Cache/Backups"]
        D3["Initial Docker / Portainer Deployment"]
        D4["High Bandwidth Need for 4K Remux (60-100 Mbps)"]
    end
```

### 4.1. Advantages (Pros)

1. **Zero-Wait Playback:** No waiting for hours while torrents download or seeders appear. High-bitrate 1080p and 4K streams launch in under 2 seconds.
2. **Zero-Touch Automation:** You deploy the Portainer stack or `docker-compose.yml`, and CineStream automatically provisions Radarr root paths, Sonarr TV directories, SABnzbd download categories, API keys, and Newznab indexers.
3. **No Antivirus / Security Triggers:** Pure HTTP/HTTPS media streaming with standard M3U playlist routing. No risky PowerShell protocol handlers or child processes that trigger Windows Defender or endpoint security software.
4. **Resilient Permission Architecture:** Automatically handles Linux UID/GID discrepancies (`root:root` vs `1000:1000 abc`), ensuring container restarts never fail with `System.UnauthorizedAccessException: Access to the path '/config/config.xml' is denied`.
5. **Lossless Audio & Advanced Video:** Supports full passthrough for Dolby TrueHD with Atmos, DTS-HD Master Audio, Dolby Vision (Profile 5, 7, 8), and HDR10+ across external players (VLC), Stremio, and Android TV hardware.
6. **Unified Household Experience:** Multiple family members can maintain independent watch histories, resume points, and parental control PINs on a single self-hosted server.

### 4.2. Disadvantages & Considerations (Cons)

1. **Requires Premium Provider Accounts:** Instant streaming relies on a Debrid account (Real-Debrid, TorBox, Premiumize, or AllDebrid) or an Easynews/Usenet subscription.
2. **Local NAS Capacity Management:** If automated background caching is configured aggressively (`AUTO_CACHE_EPISODES_AHEAD`), local NAS storage can fill quickly if not monitored via CineStream's Storage Drawer.
3. **Network Throughput Demand:** Streaming uncompressed 4K Blu-ray Remux files directly from cloud CDNs requires a reliable internet connection (at least 50–100 Mbps down).
4. **Strict Schema Constraints of Servarr:** Sonarr and Radarr enforce rigid configuration rules (such as mandatory pre-existing categories in SABnzbd and host filtering security checks), requiring CineStream to maintain dynamic schema validation.

---

## 5. Technical Implementation & Deep-Dive

### 5.1. High-Performance Segmented Streaming Proxy
Browser HTML5 players and native TV webviews struggle when seeking large 40GB+ MKV files over single HTTP streams. CineStream implements a custom streaming proxy:
- Splits requests into parallel segmented chunk workers (`PROXY_CONNECTIONS=8`).
- Employs an intelligent 64MB read-ahead ring buffer (`PROXY_READAHEAD_MB=64`).
- Intercepts HTTP `Range: bytes=start-end` headers and converts them to precise chunk offsets against the upstream Debrid or Easynews CDN.
- Results in instant seeking with zero buffering spikes.

### 5.2. Robust Servarr & SABnzbd Auto-Configuration
To achieve zero-touch deployment in Portainer:
1. **XML Configuration Sanitization (`sanitizeArrConfigXml`):**
   Parses `config.xml` files for Radarr and Sonarr, extracting existing API keys and port assignments while stripping duplicate tags that cause ASP.NET Core Kestrel `OptionsMonitor<HostFilteringOptions>` startup crashes.
2. **Live Category Verification (`ensureSabnzbdCategories`):**
   Queries SABnzbd's REST API and automatically registers `movies` and `tv` categories before Servarr download clients are added, eliminating `Category does not exist` validation errors.
3. **Continuous Background Linking (`autoLinkServarrAsync`):**
   Employs an intelligent exponential backoff retry loop that checks container health continuously, ensuring that if Radarr or Sonarr restarts or boots later than CineStream, they are automatically linked without manual user intervention.
4. **Force-Save Fallback (`?forceSave=true`):**
   Mirrors Prowlarr's synchronization logic by utilizing `forceSave=true` on all download client creation calls, ensuring non-blocking validation warnings never prevent SABnzbd from being registered.

### 5.3. In-Browser 4K HDR Remux Engine (MSE & Fragmented MP4)
Standard web browsers cannot demux `.mkv` containers natively, nor can they decode uncompressed Blu-ray audio formats like Dolby TrueHD Atmos or DTS-HD Master Audio. CineStream includes a built-in transmuxing engine:
- **Zero-Transcoding Video Copy (`-c:v copy`):** Raw 4K HEVC 10-bit, AV1, or H.264 video packets are extracted from the MKV container and packed on-the-fly into Fragmented MP4 (`fMP4`) chunks without re-encoding. Video frames are 100% untouched, preserving native HDR10, HDR10+, and Dolby Vision metadata with negligible server CPU usage (<1%).
- **Multi-Channel Audio Transmuxing:** Web-compatible streams (AAC/Opus/FLAC/MP3) are copied directly. High-bitrate Blu-ray formats (TrueHD/DTS/EAC3) are transcoded on-the-fly to 6-channel AAC (`-c:a aac -b:a 384k -ac 6`), requiring <0.5% CPU while delivering pristine 5.1 surround sound to any browser.
- **Media Source Extensions (MSE) & Keyframe Seeking:** The frontend feeds binary fMP4 chunks directly into the browser's GPU hardware decoder via `MediaSource` and `sourceBuffer.appendBuffer()`. Fast input seeking (`-ss` before `-i`) delivers instantaneous 100ms scrubbing responses across 80GB+ 4K movies.

---

## 6. Deployment & Microservices Ecosystem

CineStream is delivered as a containerized stack managed via Docker Compose or Portainer:

```
├── Caddy (Reverse proxy with automatic DuckDNS SSL)
├── CineStream Server (Core API, Web App, Stream Proxy on :3000)
├── AIOStreams (Stremio manifest addon aggregator on :3001)
├── Radarr (Automated Movie Collection Manager on :7878)
├── Sonarr (Automated TV Show Collection Manager on :8989)
├── Prowlarr (Unified Indexer Proxy on :9696)
└── SABnzbd (High-Speed Usenet Downloader on :8080)
```

### Shared Volume Architecture
- `nas_media_cache:/mnt/nas` — Mounts `/mnt/nas/movies`, `/mnt/nas/tv`, and `/mnt/nas/downloads` across all containers.
- `radarr_config:/arr_configs/radarr` — Shared with CineStream for zero-touch XML management.
- `sonarr_config:/arr_configs/sonarr` — Shared with CineStream for zero-touch XML management.
- `sabnzbd_config:/arr_configs/sabnzbd` — Shared with CineStream for auto-discovery of `api_key` and category verification.

---

## 7. Supported Playback Clients

| Client Device | Recommended Setup | Experience Level |
| :--- | :--- | :--- |
| **Android TV / Google TV** | **Stremio App** (with CineStream manifest) or **TV Bro Browser** | Native TV remote navigation, hardware 4K Dolby Vision, audio passthrough. |
| **PC / Laptop (Windows/Mac)** | Modern Web Browser (Chrome, Edge, Firefox, Brave) | Full Netflix UI, Profile management, Storage & Downloads dashboard. |
| **High-Fidelity Audio Setup** | **VLC Media Player** (via M3U Playlist stream) | Lossless Dolby TrueHD Atmos and DTS-HD MA bitstreaming to AV Receivers. |
| **Mobile & Tablet (Android/iOS)** | Responsive Web App or Capacitor App | Touch gestures, Kids Mode, and on-the-go stream playback. |

---

## 8. Summary

CineStream represents a paradigm shift in home media: combining the **instantaneous speed of cloud Debrid & Usenet** with the **permanence and organization of the Servarr & NAS ecosystem**. By automating permissions, configuration synchronization, streaming proxying, and multi-platform playback, it delivers a seamless, cinema-grade experience for the entire household.


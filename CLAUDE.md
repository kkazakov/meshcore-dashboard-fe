# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A vanilla frontend (no build step) for displaying real-time messages from a MeshCore LoRa mesh network. The entire application lives in two files: `index.html` and `app.js`.

**Stack:** Alpine.js (reactivity), Tailwind CSS (CDN), Chart.js (telemetry charts), vanilla JS fetch/WebSocket.

## Development

**Local dev** (serves at `http://localhost:8081`):
```bash
./serve-local.sh
```
This requires `.env` with `API_ENDPOINT` and `WS_ENDPOINT` set. The script copies files to `/tmp/meshcore-dashboard/`, injects the env vars via `sed`, and serves via Python's HTTP server.

**Production** (Docker, serves at `http://localhost:8080`):
```bash
./deploy.sh
```
Or manually: `docker compose down && docker compose build --no-cache && docker compose up -d`

**Configuration:**
```bash
cp .env.example .env
# Edit .env: set API_ENDPOINT and WS_ENDPOINT
```

## Architecture

Everything is a single Alpine.js component (`function app()` in `app.js`) registered with `x-data="app()"` in `index.html`. There is no component tree, no bundler, no framework router.

**Key architectural patterns:**

- **Endpoint injection at serve/build time:** `app.js` hardcodes `const API_BASE = 'http://127.0.0.1:8000'` and `const WS_BASE = 'ws://127.0.0.1:8000'` as sentinel values. Both `serve-local.sh` and the Dockerfile replace these exact strings via `sed`. Do not change these sentinel strings without updating the sed commands in both places.

- **Auth:** Token-based via `x-api-token` header. Token stored in `localStorage`. On init, token is verified against `/status`; on 401, `handleUnauthorized()` clears the session.

- **Views/pages:** `view` state (`'loading'|'login'|'dashboard'`) controls top-level rendering. Within the dashboard, `currentPage` (`'channels'|'more'|'settings'`) and `moreSubPage` (`'telemetry'|'message-links'`) control which panel is shown.

- **Real-time messaging:** WebSocket connection to `WS_BASE/ws` with exponential-backoff reconnect. Incoming messages are dispatched by type and merged into `this.messages`. The WS requires authentication (sends token after connection).

- **Telemetry charts:** Chart.js instances are stored in `this.repeaterCharts[repeater.id]` (battery/voltage) and `this.repeaterCharts[repeater.id + '-temp']` (temperature/pressure/humidity). Charts are mutated in-place on refresh (not destroyed/recreated) to avoid detaching canvas elements from Alpine's `x-for` DOM nodes.

- **iCloud image handling:** `icloudImageCache` maps short GUIDs to blob URLs. Images are fetched and cached client-side to work around CORS restrictions.

- **Channel soft-delete:** Channels can be soft-deleted (hidden) vs hard-deleted; controlled by `softDeleteChannel` flag in the delete modal.

- **Dark mode:** Stored in `localStorage`, applied via `document.documentElement.classList.add('dark')`, respects `prefers-color-scheme` as default.

## API Endpoints Used

All requests use `x-api-token` header from `localStorage('api_token')`.

| Endpoint | Purpose |
|---|---|
| `POST /api/login` | Authenticate, get token |
| `GET /status` | Token verification |
| `GET /api/channels` | List channels |
| `GET /api/messages` | Paginated message history |
| `GET /api/repeaters` | List repeaters |
| `POST /api/repeaters` | Add repeater |
| `PATCH /api/repeaters/:id` | Update repeater |
| `DELETE /api/repeaters/:id` | Delete repeater |
| `POST /api/repeaters/:id/enable` | Enable repeater |
| `POST /api/repeaters/:id/disable` | Disable repeater |
| `POST /api/repeaters/poll` | Poll repeaters for telemetry |
| `GET /api/telemetry/history/:id` | 24h telemetry history |
| `GET /api/message-links` | Message link records |
| `WS /ws` | Real-time message stream |

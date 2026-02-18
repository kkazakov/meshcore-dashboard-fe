# Meshcore Dashboard

A lightweight web frontend for the [Meshcore Dashboard API](https://github.com/kkazakov/meshcore-dashboard-api). Displays real-time messages from a MeshCore LoRa mesh network, repeater telemetry, and battery status.

Built with vanilla HTML, Alpine.js, and Tailwind CSS — no build step required.

## Requirements

- A running instance of the [Meshcore Dashboard API](https://github.com/kkazakov/meshcore-dashboard-api) — see that repo for hardware setup, ClickHouse configuration, and API deployment instructions.
- Python 3 (for local development serving)
- Docker + Docker Compose (for production deployment)

## Configuration

Copy `.env.example` to `.env` and fill in your API endpoint:

```bash
cp .env.example .env
```

Edit `.env`:

```env
API_ENDPOINT=https://your-api-host.example.com
WS_ENDPOINT=wss://your-api-host.example.com
```

| Variable | Description |
|---|---|
| `API_ENDPOINT` | Base URL of the Meshcore Dashboard API (`http://` or `https://`) |
| `WS_ENDPOINT` | WebSocket base URL of the same API (`ws://` or `wss://`). If omitted, `serve-local.sh` derives it automatically from `API_ENDPOINT`. |

Both variables must point to the same host — only the scheme differs (`https` → `wss`).

## Local development

Serves the app on `http://localhost:8081`, with endpoints substituted from `.env`:

```bash
./serve-local.sh
```

The script copies `index.html` and `app.js` to a temporary directory, replaces the hardcoded placeholder endpoints with the values from `.env`, and serves them via Python's built-in HTTP server.

## Production deployment (Docker)

Build and run with Docker Compose:

```bash
./deploy.sh
```

This builds a minimal nginx container with the API endpoints baked in at build time, and exposes the dashboard on `http://localhost:8080`.

To deploy manually:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

The Dockerfile reads `API_ENDPOINT` and `WS_ENDPOINT` from `.env` via Docker Compose build args and injects them into `app.js` at build time using `sed`.

## API & backend setup

See [github.com/kkazakov/meshcore-dashboard-api](https://github.com/kkazakov/meshcore-dashboard-api) for:

- Hardware and MeshCore device configuration
- ClickHouse database setup
- API server installation and running instructions
- Authentication / token management

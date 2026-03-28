# Meshcore Dashboard Frontend - Agent Guidelines

## Project Overview

A lightweight mesh network dashboard frontend built with vanilla HTML, Alpine.js, and Tailwind CSS. No build step required.

**API Base**: `http://127.0.0.1:8000` (configured in `app.js`)
**WebSocket Base**: `ws://127.0.0.1:8000` (configured in `app.js`)

---

## Development Commands

### Local Development
```bash
./serve-local.sh
```
Serves on `http://localhost:8081` with endpoints substituted from `.env`.

### Production Build
```bash
./deploy.sh
```
Builds nginx container; serves on `http://localhost:8080`.

### Manual Deployment
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## Code Style Guidelines

### Imports & Dependencies
- No module imports (vanilla JS in `<script>` tags)
- External libraries loaded via CDN:
  - Alpine.js (defer, latest 3.x)
  - Tailwind CSS (CDN script)
  - Chart.js (CDN script)

### JavaScript Conventions

**Functions**: Arrow functions, async/await preferred
```javascript
async fetchChannels() {
    this.channelsLoading = true;
    try {
        const response = await fetch(`${API_BASE}/api/channels`, {
            headers: { 'x-api-token': localStorage.getItem('api_token') }
        });
        const data = await response.json();
        this.channels = data.channels || [];
    } catch (err) {
        console.error(err);
    } finally {
        this.channelsLoading = false;
    }
}
```

**Naming**: camelCase for properties/methods, underscore prefix for private members
```javascript
_originalTitle  // private property
_init()        // private method
```

**Indentation**: 4 spaces

### Alpine.js Patterns

**Component root**:
```html
<body x-data="app()" x-init="init()">
```

**State binding**:
```html
<div x-show="view === 'dashboard'">
<span x-text="user.email"></span>
<input x-model="newMessage">
```

**Event handling**:
```html
<button @click="sendMessage()">
<form @submit.prevent="login()">
```

### Error Handling

**API requests**:
```javascript
try {
    const response = await fetch(url, options);
    if (response.status === 401) {
        this.handleUnauthorized();
        return;
    }
    if (!response.ok) {
        throw new Error('Failed to ...');
    }
    const data = await response.json();
} catch (err) {
    console.error(err);
}
```

**Token fallback**:
```javascript
const data = await response.json().catch(() => ({}));
```

### Styling

**Tailwind CSS** with custom theme:
```javascript
tailwind.config = {
    darkMode: 'class',
    theme: { extend: { colors: { primary: '#6366f1', secondary: '#8b5cf6' } } }
};
```

**Dark mode**: Toggle `dark` class on `<html>`, use utility pairs
```html
:bg-white dark:bg-gray-800 text-gray-800 dark:text-white
```

---

## Architecture Notes

**Single-file monolith**: All logic in `app.js` exported via `app()` IIFE.

**Views**: `'loading' | 'login' | 'dashboard'`

**Pages** (within dashboard): `'messages' | 'telemetry' | 'configuration'`

**WebSocket**: Manual reconnect with exponential backoff (1s → 30s cap).

**Charts**: Chart.js instances stored in `repeaterCharts` map, destroyed on theme toggle/page switch.

---

## Files

| File | Purpose |
|------|---------|
| `app.js` | All application logic (Alpine.js component) |
| `index.html` | Template, Tailwind/CDN config |
| `serve-local.sh` | Development server with env injection |
| `deploy.sh` | Docker build/run |
| `Dockerfile` | nginx-based production image |
| `docker-compose.yml` | Container config |

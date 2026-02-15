#!/bin/bash
set -e

source .env

mkdir -p /tmp/meshcore-dashboard
cp index.html /tmp/meshcore-dashboard/
sed "s|const API_BASE = 'http://127.0.0.1:8000';|const API_BASE = '${API_ENDPOINT}';|g" app.js | \
    sed "s|const WS_BASE = 'ws://127.0.0.1:8000';|const WS_BASE = '${WS_ENDPOINT}';|g" > /tmp/meshcore-dashboard/app.js

echo "Serving at http://localhost:8081"
cd /tmp/meshcore-dashboard && python3 -m http.server 8081

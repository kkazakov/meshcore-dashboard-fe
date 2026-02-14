#!/bin/bash
set -e

docker compose down
docker compose build --no-cache
docker compose up -d

echo "Deployed at http://localhost:8080"

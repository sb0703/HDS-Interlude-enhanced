#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi

install -d -m 700 \
  data/instance-1/qq data/instance-1/config data/instance-1/plugins \
  data/instance-2/qq data/instance-2/config data/instance-2/plugins

docker pull --platform linux/amd64 mlikiowa/napcat-docker:v4.15.19
./verify-versions.sh
docker compose config --quiet
docker compose up -d
docker compose ps

cat <<'EOF'

NapCat containers are running.
Open an SSH tunnel from your own computer:
  ssh -L 6099:127.0.0.1:6099 -L 6100:127.0.0.1:6100 your-server

Then open:
  Bot 1: http://127.0.0.1:6099/webui
  Bot 2: http://127.0.0.1:6100/webui

Read each WebUI token directly on the server with:
  docker logs hds-napcat-1
  docker logs hds-napcat-2
EOF

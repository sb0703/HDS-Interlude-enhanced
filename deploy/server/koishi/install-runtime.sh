#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HDS_ROOT:-/opt/hds-interlude}"
APP_DIR="${ROOT_DIR}/.local-hdsi/koishi-app"
RUNTIME_DIR="${ROOT_DIR}/runtime"
NODE_VERSION="20.19.0"
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_DIR="${RUNTIME_DIR}/node-v${NODE_VERSION}-linux-x64"
PLUGIN_ARCHIVE="${ROOT_DIR}/koishi-plugin-hds-interlude-0.1.5-beta8-m6.custom.4.tgz"
PLUGIN_SHA256="${HDS_PLUGIN_SHA256:-03AB95C4249D9250F0A46EAB42D837181F7C4F7783D6E96408CE5AF395AF3A48}"

if [[ ! -f "${APP_DIR}/package.json" || ! -f "${APP_DIR}/koishi.yml" ]]; then
  echo "ERROR: Koishi application files have not been uploaded to ${APP_DIR}." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/data/koishi.db" ]]; then
  echo "ERROR: Koishi database is missing." >&2
  exit 1
fi

echo "${PLUGIN_SHA256}  ${PLUGIN_ARCHIVE}" | sha256sum --check --status || {
  echo "ERROR: HDSI plugin archive checksum mismatch." >&2
  exit 1
}

mkdir -p "${RUNTIME_DIR}"
if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' EXIT
  curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    --output "${temp_dir}/${NODE_ARCHIVE}"
  curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    --output "${temp_dir}/SHASUMS256.txt"
  grep "  ${NODE_ARCHIVE}$" "${temp_dir}/SHASUMS256.txt" >"${temp_dir}/SHASUMS256.selected"
  (
    cd "${temp_dir}"
    sha256sum --check SHASUMS256.selected
  )
  tar -xJf "${temp_dir}/${NODE_ARCHIVE}" -C "${RUNTIME_DIR}"
fi

cd "${APP_DIR}"
export PATH="${NODE_DIR}/bin:${PATH}"
"${NODE_DIR}/bin/node" --version
"${NODE_DIR}/bin/npm" --version
"${NODE_DIR}/bin/npm" ci --no-audit --no-fund

installed_version="$("${NODE_DIR}/bin/node" -p "require('./node_modules/koishi-plugin-hds-interlude/package.json').version")"
if [[ "${installed_version}" != "0.1.5-beta8-m6.custom.4" ]]; then
  echo "ERROR: installed HDSI version is ${installed_version}." >&2
  exit 1
fi

sudo install -o root -g root -m 0644 \
  "${ROOT_DIR}/koishi-deploy/hds-interlude-koishi.service" \
  /etc/systemd/system/hds-interlude-koishi.service
sudo systemctl daemon-reload
sudo systemctl enable --now hds-interlude-koishi.service

echo "Koishi service installed."
sudo systemctl --no-pager --full status hds-interlude-koishi.service

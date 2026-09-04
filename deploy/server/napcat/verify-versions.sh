#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="mlikiowa/napcat-docker:v4.15.19"
IMAGE_DIGEST="mlikiowa/napcat-docker@sha256:77c9fa8d8ae05b6a15251e3f0121392b466828444877b276b57aca0e9ff776e0"
EXPECTED_QQ_VERSION="3.2.21-42086"

echo "Checking pinned NapCat image..."
docker image inspect "${IMAGE_DIGEST}" >/dev/null

tag_id="$(docker image inspect --format '{{.Id}}' "${IMAGE_TAG}")"
digest_id="$(docker image inspect --format '{{.Id}}' "${IMAGE_DIGEST}")"
if [[ "${tag_id}" != "${digest_id}" ]]; then
  echo "ERROR: ${IMAGE_TAG} does not resolve to the pinned image." >&2
  exit 1
fi

qq_version="$(docker run --rm --entrypoint dpkg-query "${IMAGE_DIGEST}" -W -f='${Version}' linuxqq)"
if [[ "${qq_version}" != "${EXPECTED_QQ_VERSION}" ]]; then
  echo "ERROR: expected Linux QQ ${EXPECTED_QQ_VERSION}, got ${qq_version}." >&2
  exit 1
fi

qq_package_version="$(docker run --rm --entrypoint /bin/sh "${IMAGE_DIGEST}" -lc \
  "sed -n 's/^[[:space:]]*\"version\":[[:space:]]*\"\([^\"]*\)\".*/\1/p' /opt/QQ/resources/app/package.json | head -n 1")"
if [[ "${qq_package_version}" != "${EXPECTED_QQ_VERSION}" ]]; then
  echo "ERROR: QQ package metadata reports ${qq_package_version}." >&2
  exit 1
fi

echo "OK: NapCat image tag v4.15.19 is pinned to sha256:77c9fa8d8ae05b6a15251e3f0121392b466828444877b276b57aca0e9ff776e0"
echo "OK: Linux QQ ${qq_version}"


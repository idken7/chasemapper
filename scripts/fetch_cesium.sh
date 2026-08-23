#!/usr/bin/env bash
# Downloads Cesium's browser build into static/vendor/cesium/ for local
# (non-Docker) development. The Docker build does the equivalent as an image
# build step (see the Dockerfile) - this script exists so `python3
# horusmapper.py` run directly against a checkout also has a working map.
#
# CESIUM_VERSION must match what templates/index.html expects
# (window.CESIUM_BASE_URL and the Cesium.js/widgets.css tags).
set -euo pipefail

CESIUM_VERSION="1.126.0"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/static/vendor/cesium"

echo "Fetching Cesium ${CESIUM_VERSION} into ${DEST} ..."
rm -rf "$DEST"
mkdir -p "$DEST"
curl -sL "https://registry.npmjs.org/cesium/-/cesium-${CESIUM_VERSION}.tgz" \
  | tar -xz -C "$DEST" --strip-components=3 package/Build/Cesium

echo "Done. ${DEST}/Cesium.js should now exist."

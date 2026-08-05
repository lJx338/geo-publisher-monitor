#!/bin/sh
set -eu

DIRECTORY=${1:?usage: upload-release.sh directory}
: "${TENCENT_CLOUD_SECRET_ID:?missing TENCENT_CLOUD_SECRET_ID}"
: "${TENCENT_CLOUD_SECRET_KEY:?missing TENCENT_CLOUD_SECRET_KEY}"
: "${TENCENT_COS_BUCKET:?missing TENCENT_COS_BUCKET}"
: "${TENCENT_COS_REGION:?missing TENCENT_COS_REGION}"

PREFIX=${TENCENT_COS_PREFIX:-geo-publisher-monitor}
CONFIG=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/geo-publisher-monitor-cos.conf
MANIFEST=$DIRECTORY/latest-mac.yml
[ -f "$MANIFEST" ] || { echo "latest-mac.yml not found" >&2; exit 1; }
VERSION=$(node -e "const fs=require('fs');const YAML=require('yaml');process.stdout.write(YAML.parse(fs.readFileSync(process.argv[1],'utf8')).version)" "$MANIFEST")
PUBLIC_BASE=${GEO_MONITOR_UPDATE_BASE:-https://${TENCENT_COS_BUCKET}.cos.${TENCENT_COS_REGION}.myqcloud.com/${PREFIX}/releases}
VERSION_KEY=$PREFIX/releases/versions/$VERSION/mac-arm64
VERSION_URL=$PUBLIC_BASE/versions/$VERSION/mac-arm64
RENDERED=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/latest-mac.yml

rm -f "$CONFIG" "$RENDERED"
trap 'rm -f "$CONFIG" "$RENDERED"' EXIT INT TERM
coscmd -c "$CONFIG" config -a "$TENCENT_CLOUD_SECRET_ID" -s "$TENCENT_CLOUD_SECRET_KEY" -b "$TENCENT_COS_BUCKET" -r "$TENCENT_COS_REGION" --retry 5 --timeout 120

found=0
for file in "$DIRECTORY"/*.dmg "$DIRECTORY"/*.zip "$DIRECTORY"/*.blockmap; do
  [ -f "$file" ] || continue
  found=1
  coscmd -c "$CONFIG" upload -f -y -H '{"Cache-Control":"public, max-age=31536000, immutable"}' "$file" "$VERSION_KEY/$(basename "$file")"
done
[ "$found" -eq 1 ] || { echo "no macOS artifacts found" >&2; exit 1; }

node scripts/render-channel-manifest.mjs "$MANIFEST" "$RENDERED" "$VERSION_URL"
coscmd -c "$CONFIG" upload -f -y -H '{"Cache-Control":"public, max-age=31536000, immutable"}' "$RENDERED" "$VERSION_KEY/latest-mac.yml"
coscmd -c "$CONFIG" upload -f -y -H '{"Cache-Control":"no-cache, no-store, must-revalidate"}' "$RENDERED" "$PREFIX/releases/channels/stable/mac-arm64/latest-mac.yml"

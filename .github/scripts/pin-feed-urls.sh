#!/usr/bin/env bash
# Usage: pin-feed-urls.sh <release download URL> <latest*.yml>...
#
# electron-builder writes each update file as a bare name, which the app resolves
# against its feed URL. Installed apps read the feed from /releases/latest/download
# (or the legacy preview release), so a bare name would follow whichever release is
# newest by the time the download starts. Pinning each name to the release that
# holds it keeps a feed valid after a newer release replaces it, and the app derives
# the blockmap URLs from it.
set -euo pipefail

base="${1:?release download URL}"
shift

for feed in "$@"; do
  sed -E "s#^( *(- )?(url|path): )([^/[:space:]]+)\$#\1${base}/\4#" "$feed" > "$feed.tmp"
  mv "$feed.tmp" "$feed"

  if ! grep -Eq '^ *- url: https://' "$feed" \
    || grep -E '^ *(- )?(url|path): ' "$feed" | grep -vq ': https://'; then
    echo "$feed must name its update files by absolute URL:" >&2
    cat "$feed" >&2
    exit 1
  fi
done

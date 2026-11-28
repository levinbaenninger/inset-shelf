#!/usr/bin/env bash
# Imports the shared signing identity into a new keychain for scripts/sign-mac.ts.
# Reads MAC_SIGNING_P12_BASE64 and MAC_SIGNING_P12_PASSWORD; prints the keychain path.
# With ADD_TO_SEARCH_LIST=1 (CI) the keychain also joins the user's search list.
set -euo pipefail

dir="${1:?usage: import-signing-key.sh <dir>}"
keychain="$dir/inset-signing.keychain-db"
password="$(openssl rand -hex 24)"
p12="$(mktemp "$dir/signing.XXXXXX")"
trap 'rm -f "$p12"' EXIT

printf '%s' "$MAC_SIGNING_P12_BASE64" | base64 --decode > "$p12"

# Commands that take a password go to `security -i` on stdin, so no password shows in argv.
# A plain `unlock-keychain` without -p reads /dev/tty when there is one and hangs locally.
quote() {
  local value="${1//\\/\\\\}"
  printf '"%s"' "${value//\"/\\\"}"
}
secure() {
  printf '%s\n' "$1" | security -i
}

secure "create-keychain -p $(quote "$password") $(quote "$keychain")"
security set-keychain-settings -lut 21600 "$keychain"
secure "unlock-keychain -p $(quote "$password") $(quote "$keychain")"
secure "import $(quote "$p12") -f pkcs12 -k $(quote "$keychain") -P $(quote "$MAC_SIGNING_P12_PASSWORD") -T /usr/bin/codesign" >&2
secure "set-key-partition-list -S apple-tool:,apple: -s -k $(quote "$password") $(quote "$keychain")" > /dev/null

if [[ "${ADD_TO_SEARCH_LIST:-}" == "1" ]]; then
  # shellcheck disable=SC2046
  security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
fi

echo "$keychain"

#!/usr/bin/env bash
set -euo pipefail

base=$(git merge-base "${1:?PR base SHA}" "${2:?PR head SHA}")
head=$2
inputs=(apps/web packages/ui package.json pnpm-lock.yaml pnpm-workspace.yaml)
if git diff --quiet "$base" "$head" -- "${inputs[@]}"; then
  echo "Website inputs are unchanged."
  exit 0
fi

check_preview() {
  gh api --method GET "repos/{owner}/{repo}/commits/$1/check-runs" \
    -f check_name='Workers Builds: inset-shelf' -F app_id=85455 \
    --jq '[.check_runs[] | select(.app.slug == "cloudflare-workers-and-pages")] | max_by(.id) |
      if . == null then "missing"
      elif .status != "completed" then "pending"
      elif .conclusion != "success" then .conclusion
      else (.output.summary // "" | split("\n") | map(select(startswith("Preview URL: https://"))) | first // "missing preview URL")
      end'
}

# Cloudflare can skip a desktop-only push after publishing a preview for the same website.
commits=$(git rev-list --first-parent "$base..$head")
eligible=()
for commit in $commits; do
  git diff --quiet "$commit" "$head" -- "${inputs[@]}" || break
  eligible+=("$commit")
done

echo "Waiting for Cloudflare to preview the website at $head"
while true; do
  for commit in "${eligible[@]}"; do
    result=$(check_preview "$commit")
    case "$result" in
      missing) continue ;;
      pending) break ;;
      'Preview URL: https://'*)
        echo "$commit $result"
        exit 0 ;;
      *)
        echo "Cloudflare preview for $commit: $result" >&2
        exit 1 ;;
    esac
  done
  sleep 15
done

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
preview_commit=$head
result=missing
for commit in $commits; do
  git diff --quiet "$commit" "$head" -- "${inputs[@]}" || break
  result=$(check_preview "$commit")
  if [[ $result != missing ]]; then
    preview_commit=$commit
    break
  fi
done

echo "Checking Cloudflare website preview for $preview_commit"
while [[ $result == pending || $result == missing ]]; do
  sleep 15
  result=$(check_preview "$preview_commit")
done
echo "$result"
[[ $result == 'Preview URL: https://'* ]]

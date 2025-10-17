TARGET_DIR="public/data/"

set -euo pipefail

echo "1. Sync starting... ${CF_DOMAIN}/api/github/syncStart"
LIST=$(curl -fsS  \
  -H "Authorization: Bearer ${CF_GH_SECRET}" \
  "${CF_DOMAIN}/api/github/syncStart"
)
echo "2. Sync list of files: '$LIST'."

if [[ -z "${LIST//[[:space:]]/}" ]]; then
  echo "X. List of files to sync is empty."
  exit 0
fi

for file in $(echo "$LIST" | xargs); do
  url="${CF_DOMAIN}/api/github/readFile/${file}"
  echo "3. fetching file... ${url}"
  tmp="$(mktemp)"
  http=$(curl -sS \
    -H "Authorization: Bearer ${CF_GH_SECRET}" \
    -w "%{http_code}" \
    -o "$tmp" \
    "$url" || true)

  # Treat 2xx with non-empty body as "has data"
  if [[ "$http" =~ ^2 && -s "$tmp" ]]; then
    target="${TARGET_DIR}${file}"     
    echo "4. saving file... ${target}"
    mkdir -p "$(dirname "$target")"
    mv "$tmp" "$target"
    git add "$target"
  elif [[ "$http" =~ ^2 ]]; then
    echo "E1. Empty file: ${url}"
    exit 1
  else
    echo "E2. File not found: ${url}"
    exit 1
  fi
  rm -f "$tmp"
done

echo "4. Generating file list in files.json"
find "$TARGET_DIR" -type f \
  | cut -c $(( ${#TARGET_DIR} + 1 ))- \
  | jq -R . \
  | jq -s . \
> files.json

gitStatus=$(git status --porcelain)
echo "5. To be commited: ${gitStatus}"

COMMIT=${COMMIT:-false}
if [[ -n "$gitStatus" && "$COMMIT" == "true" ]]; then
  git config --local user.email "action@github.com"
  git config --local user.name "GitHub Actions Worker Sync"
  git add -A
  git commit -m "Sync data: $(date -u +%FT%TZ)"
  git push
  echo "Changes committed and pushed."
fi


echo "6. Calling ${CF_DOMAIN}/api/github/syncEnd"
response=$(curl -sS \
  -X POST \
  -H "Authorization: Bearer ${CF_GH_SECRET}" \
  -H "Content-Type: text/plain" \
  -d "$LIST" \
  -w "\n%{http_code}" "${CF_DOMAIN}/api/github/syncEnd")
status=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
echo "X. Sync completed: ${status}: ${body}"

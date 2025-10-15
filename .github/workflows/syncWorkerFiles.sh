set -euo pipefail

echo "1. Sync starting... ${BASE_URL}/api/github/syncStart"
LIST=$(curl -fsS  \
  -H "Authorization: Bearer ${CF_GH_SECRET}" \
  "${BASE_URL}/api/github/syncStart"
)
echo "2. Sync list of files: '$LIST'."

if [[ -z "${LIST//[[:space:]]/}" ]]; then
  echo "X. List of files to sync is empty."
  exit 0
fi

for file in $(echo "$LIST" | xargs); do
  url="${BASE_URL}/api/github/readFile/${file}"
  echo "3. fetching file... ${url}"
  tmp="$(mktemp)"
  http=$(curl -sS \
    -H "Authorization: Bearer ${CF_GH_SECRET}" \
    -w "%{http_code}" \
    -o "$tmp" \
    "$url" || true)

  # Treat 2xx with non-empty body as "has data"
  if [[ "$http" =~ ^2 && -s "$tmp" ]]; then
    target="public/data/events/${file}"     
    echo "4. saving file... ${target}"
    mkdir -p "$(dirname "$target")"
    mv "$tmp" "$target"
    git add "$target"
  elif [[ "$http" =~ ^2 ]]; then
    echo "E1. File $url is empty."
  else
    echo "E2. Failed fetching $url."
  fi
  rm -f "$tmp"
done

gitStatus=$(git status --porcelain)
echo "To be commited: ${gitStatus}"

COMMIT=${COMMIT:-false}
if [[ -n "$gitStatus" && "$COMMIT" == "true" ]]; then
  git config --local user.email "action@github.com"
  git config --local user.name "GitHub Actions Worker Sync"
  git add -A
  git commit -m "Sync data: $(date -u +%FT%TZ)"
  git push
  echo "Changes committed and pushed."
fi


echo "4. Calling ${BASE_URL}/api/github/syncEnd"
response=$(curl -sS \
  -X POST \
  -H "Authorization: Bearer ${CF_GH_SECRET}" \
  -H "Content-Type: text/plain" \
  -d "$LIST" \
  -w "\n%{http_code}" "${BASE_URL}/api/github/syncEnd")
status=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
echo "X. Sync completed: ${status}: ${body}"

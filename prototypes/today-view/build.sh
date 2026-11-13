#!/bin/sh
# PROTOTYPE build: embeds the sample path into the pages. Run: sh prototypes/today-view/build.sh
set -e
cd "$(dirname "$0")"
npx -y js-yaml@4.1.0 ../../samples/eval-infra-17-weeks.yaml > .path.json
for name in today-view today-prototype; do
  node -e 'const fs=require("fs"),n=process.argv[1];fs.writeFileSync(n+".html",fs.readFileSync(n+".template.html","utf8").replace("/*__PATH_JSON__*/null",fs.readFileSync(".path.json","utf8").trim()))' "$name"
done
rm .path.json
echo "Built today-view.html (chosen design) and today-prototype.html (the A/B/C comparison)."

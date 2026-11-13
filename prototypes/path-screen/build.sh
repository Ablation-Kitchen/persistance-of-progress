#!/bin/sh
# PROTOTYPE build: embeds the sample path into the page. Run: sh prototypes/path-screen/build.sh
set -e
cd "$(dirname "$0")"
npx -y js-yaml@4.1.0 ../../samples/eval-infra-17-weeks.yaml > .path.json
node -e 'const fs=require("fs");fs.writeFileSync("path-prototype.html",fs.readFileSync("path-prototype.template.html","utf8").replace("/*__PATH_JSON__*/null",fs.readFileSync(".path.json","utf8").trim()))'
rm .path.json
echo "Built path-prototype.html (variants A Outline, B Calendar, C Milestones; ?variant= and ?scenario=)."

#!/usr/bin/env bash
# Captures every scene, one app launch per scene (robust against crashes in a
# long-running session), and merges the per-scene filter dumps.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
STAGE="${GLASSFORM_STAGE:-$HOME/Library/Caches/glassform-fidelity}"
mkdir -p native-captures "$STAGE/merged"
rm -f "$STAGE/merged"/*.json
ids=$(node -e "console.log(JSON.parse(require('fs').readFileSync('scenes.json','utf8')).scenes.map(s=>s.id).join(' '))")
failed=()
for id in $ids; do
  if native/capture.sh "$id" > /dev/null 2>&1; then
    cp "$STAGE/out/native-filters.json" "$STAGE/merged/$id.json"
    echo "ok $id"
  else
    failed+=("$id"); echo "FAILED $id"
  fi
done
node -e "
const fs = require('fs'), path = require('path')
const dir = process.argv[1]
const merged = { scenes: {} }
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  merged.macOS = d.macOS
  Object.assign(merged.scenes, d.scenes)
}
fs.writeFileSync('native-captures/native-filters.json', JSON.stringify(merged, null, 2) + '\n')
console.log('merged', Object.keys(merged.scenes).length, 'scene dumps')
" "$STAGE/merged"
rm -f native-captures/capture-log.txt
if [[ ${#failed[@]} -gt 0 ]]; then echo "failed: ${failed[*]}"; exit 1; fi

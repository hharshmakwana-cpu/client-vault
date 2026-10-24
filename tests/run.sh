#!/usr/bin/env bash
# Runs every browser test against the app served from this folder's parent.
# Needs Node and Playwright (with Chromium). Usage: tests/run.sh
cd "$(dirname "$0")"
PORT=${PORT:-8123}
export BASE="http://localhost:$PORT/"
if ! curl -s -o /dev/null "$BASE"; then
  (cd .. && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &)
  sleep 1
fi
failed=0
for t in features new-user contacts firm-details logo screens face-id offline team conflict audit; do
  out=$(timeout 300 node "$t.js" 2>&1); code=$?
  pass=$(grep -c '^PASS' <<<"$out"); fail=$(grep -c '^FAIL' <<<"$out")
  if [ $code -eq 0 ]; then echo "ok    $t ($pass checks)"; else echo "FAIL  $t"; grep -E '^FAIL|Error' <<<"$out" | head -5; failed=1; fi
done
exit $failed

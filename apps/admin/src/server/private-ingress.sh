#!/bin/bash
# Dedicated Fly node only. The volume and local API socket are root-owned;
# the application keeps its unprivileged identity and cannot read node keys.
set -euo pipefail
umask 077
cd /app/apps/admin
bun -e 'import { readAdminConfig } from "./src/config.ts"; const c = readAdminConfig(process.env); if (c.NODE_ENV !== "production" || c.ADMIN_HOST !== "127.0.0.1" || c.ADMIN_PORT !== 8080) throw new Error("Invalid private admin listener configuration")' </dev/null
mountpoint -q /var/lib/tailscale || { echo 'Admin ingress requires its state volume' >&2; exit 1; }
chmod 700 /var/lib/tailscale
mkdir -p /run/tailscale
chmod 700 /run/tailscale
socket=/run/tailscale/tailscaled.sock
daemon_pid=
app_pid=
stop() {
  trap - TERM INT EXIT
  [ -z "$app_pid" ] || kill -TERM "$app_pid" 2>/dev/null || true
  [ -z "$daemon_pid" ] || kill -TERM "$daemon_pid" 2>/dev/null || true
  ( sleep 15; [ -z "$app_pid" ] || kill -KILL "$app_pid" 2>/dev/null || true; [ -z "$daemon_pid" ] || kill -KILL "$daemon_pid" 2>/dev/null || true ) &
  watchdog=$!
  wait "$app_pid" "$daemon_pid" 2>/dev/null || true
  kill "$watchdog" 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT
trap stop EXIT
# Suppress daemon output: it can contain authentication URLs and device data.
TS_NO_LOGS_NO_SUPPORT=true tailscaled --tun=userspace-networking \
  --state=/var/lib/tailscale/tailscaled.state --statedir=/var/lib/tailscale \
  --socket="$socket" >/dev/null 2>&1 </dev/null &
daemon_pid=$!
# Never initiate a login here. Fly SSH can run the documented private CLI
# while NeedsLogin/NeedsMachineAuth persists; there is no restart/login loop.
while true; do
  kill -0 "$daemon_pid" 2>/dev/null || exit 1
  if tailscale --socket="$socket" status --json 2>/dev/null | bun src/server/ingress-status.ts; then break; fi
  sleep 2 & wait $!
done
# Replace any saved Serve/Funnel config with this node's sole private handler.
tailscale --socket="$socket" serve reset >/dev/null 2>&1
tailscale --socket="$socket" debug prefs 2>/dev/null | bun src/server/ingress-status.ts prefs
tailscale --socket="$socket" serve --bg --https=443 http://127.0.0.1:8080 >/dev/null 2>&1
# Do not open the backend until identity/prefs and the private handler are
# admitted. A restored stale handler cannot reach the application meanwhile.
setpriv --reuid=daisy --regid=daisy --init-groups bun src/server/start.ts </dev/null &
app_pid=$!
# --bg is persisted by tailscaled; its death or the app's death ends the VM.
wait -n "$daemon_pid" "$app_pid"
exit 1

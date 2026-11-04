#!/bin/bash
# Web's machine (ADR 0116): the gate on Fly's port, web on loopback behind it. A gate that
# dies comes back without touching web, so debates keep their process. One that keeps
# dying ends the machine, which fails Fly's checks and the alert probe's readiness read.
set -euo pipefail

: "${PORT:?PORT names the port web binds behind the gate}"

log_event() {
  printf '{"level":%s,"time":%s,"service":"web-gate","event":"%s","msg":"%s"}\n' \
    "$1" "$(($(date +%s) * 1000))" "$2" "$3"
}

# The default route's gateway, from the route table's little-endian hex (DEC-39).
gateway=
gateways=0
while read -r _ destination hex _; do
  [ "$destination" = 00000000 ] && [ "$hex" != 00000000 ] || continue
  gateway=$(printf '%d.%d.%d.%d' "0x${hex:6:2}" "0x${hex:4:2}" "0x${hex:2:2}" "0x${hex:0:2}")
  gateways=$((gateways + 1))
done < <(tail -n +2 /proc/net/route)
if [ "$gateways" != 1 ]; then
  log_event 60 web_gate.gateway_unresolved 'No single default gateway, so the gate cannot name callers'
  exit 1
fi

mkdir -p /tmp/web-gate
sed -e "s/GATEWAY_ADDRESS/$gateway/g" -e "s/WEB_PORT/$PORT/g" \
  "$(dirname "$0")/nginx.conf.template" > /tmp/web-gate/nginx.conf
nginx -e /dev/stderr -t -q -c /tmp/web-gate/nginx.conf

web_pid=
gate_pid=
start_gate() {
  nginx -e /dev/stderr -c /tmp/web-gate/nginx.conf -g 'daemon off;' &
  gate_pid=$!
}
# Fly sends SIGINT. The gate keeps answering until web has drained.
stop_web() {
  trap - INT TERM
  kill -INT "$web_pid" 2>/dev/null || true
}
trap stop_web INT TERM

start_gate
bun src/server/start.ts &
web_pid=$!

deaths=0
window_started=$(date +%s)
while true; do
  status=0
  wait -n "$web_pid" "$gate_pid" || status=$?
  if ! kill -0 "$web_pid" 2>/dev/null; then
    wait "$web_pid" || status=$?
    kill -QUIT "$gate_pid" 2>/dev/null || true
    wait "$gate_pid" 2>/dev/null || true
    exit "$status"
  fi
  if kill -0 "$gate_pid" 2>/dev/null; then
    continue # a signal woke the wait: web is draining
  fi
  now=$(date +%s)
  if [ $((now - window_started)) -gt 60 ]; then
    deaths=0
    window_started=$now
  fi
  deaths=$((deaths + 1))
  if [ "$deaths" -ge 5 ]; then
    log_event 60 web_gate.gave_up 'The gate keeps dying: ending the machine'
    stop_web
    continue
  fi
  log_event 50 web_gate.restarted 'The gate died and is starting again'
  sleep 1
  start_gate
done

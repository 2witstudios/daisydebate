#!/bin/sh
# Writes LiveKit's config from the machine's network and starts the server.
# LIVEKIT_NODE_IP (fly.livekit.toml) is the app's dedicated public IPv4, the
# address advertised in every ICE candidate. The UDP mux binds only the
# fly-global-services address, the one Fly routes public UDP to and accepts
# replies from (https://fly.io/docs/networking/udp-and-tcp/). LIVEKIT_KEYS
# (key: secret) comes from Fly secrets and is read by the server directly.
set -eu
: "${LIVEKIT_NODE_IP:?LIVEKIT_NODE_IP is required}"
: "${LIVEKIT_KEYS:?LIVEKIT_KEYS is required}"
udp_ip="$(getent ahostsv4 fly-global-services | awk 'NR==1{print $1}')"
[ -n "$udp_ip" ] || { echo 'fly-global-services did not resolve' >&2; exit 1; }
cat > /tmp/livekit.yaml <<CONFIG
port: 7880
bind_addresses:
  - 0.0.0.0
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: ${LIVEKIT_NODE_IP}
  ips:
    includes:
      - ${udp_ip}/32
room:
  auto_create: false
  empty_timeout: 300
  departure_timeout: 20
logging:
  level: info
CONFIG
exec /livekit-server --config /tmp/livekit.yaml

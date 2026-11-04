#!/bin/sh
# Two throwaway LiveKit nodes and their Redis for proving the node kill drill on
# one machine, beside the shared local LiveKit and never touching it.
#   local-nodes.sh up <E2E_PORT> <env-file>   starts them, writes the drill's settings
#   local-nodes.sh down                       removes only these containers
# one-node: DRILL_LOCAL_ONE_NODE=1 starts a single node with no Redis, staging's shape.
set -eu
image=livekit/livekit-server:v1.13.7
network=daisy-mr-local
remove() { docker rm -f daisy-mr-local-a daisy-mr-local-b daisy-mr-local-redis >/dev/null 2>&1 || true; }
start_node() { # name http-port rtc-tcp-port rtc-udp-port
  redis_config=""
  [ -z "${DRILL_LOCAL_ONE_NODE:-}" ] && redis_config="redis: { address: daisy-mr-local-redis:6379 }"
  docker run -d --name "$1" --network "$network" \
    -p "127.0.0.1:$2:7880" -p "127.0.0.1:$3:$3/tcp" -p "127.0.0.1:$4:$4/udp" \
    -e LIVEKIT_CONFIG="
port: 7880
bind_addresses: ['0.0.0.0']
rtc: { tcp_port: $3, udp_port: $4, use_external_ip: false, node_ip: 127.0.0.1 }
$redis_config
room: { auto_create: false, empty_timeout: 300, departure_timeout: 20 }
keys: { $key: $secret }
logging: { level: info }
" "$image" >/dev/null
}
case "${1:-}" in
down)
  remove
  docker network rm "$network" >/dev/null 2>&1 || true
  ;;
up)
  port=$2
  file=$3
  key="drill$(openssl rand -hex 6)"
  secret=$(openssl rand -hex 32)
  remove
  docker network create "$network" >/dev/null 2>&1 || true
  node() { printf '{"app":"%s","machine":"local","apiUrl":"http://127.0.0.1:%s","publicUrl":"wss://localhost:%s","media":"127.0.0.1:%s"}' "$1" "$2" "$3" "$4"; }
  a=$(node daisy-mr-local-a 18880 $((port + 4)) 18882)
  if [ -n "${DRILL_LOCAL_ONE_NODE:-}" ]; then
    nodes="[$a]"
    edges="[{\"port\":$((port + 4)),\"upstreamPort\":18880}]"
    start_node daisy-mr-local-a 18880 18881 18882
  else
    docker run -d --name daisy-mr-local-redis --network "$network" redis:8.6.1-alpine >/dev/null
    b=$(node daisy-mr-local-b 18890 $((port + 7)) 18892)
    nodes="[$a,$b]"
    edges="[{\"port\":$((port + 4)),\"upstreamPort\":18880},{\"port\":$((port + 7)),\"upstreamPort\":18890}]"
    start_node daisy-mr-local-a 18880 18881 18882
    start_node daisy-mr-local-b 18890 18891 18892
  fi
  umask 077
  cat >"$file" <<SETTINGS
export DRILL_NODES='$nodes'
export ROOM_LAUNCH_MEDIA_EDGES='$edges'
export DRILL_KILL_COMMAND='["docker","kill","{app}"]'
export DRILL_START_COMMAND='["docker","start","{app}"]'
export DRILL_STATE_COMMAND='["docker","inspect","-f","{{.State.Status}}","{app}"]'
export DRILL_LIVEKIT_API_KEY='$key'
export DRILL_LIVEKIT_API_SECRET='$secret'
SETTINGS
  ;;
*)
  echo 'usage: local-nodes.sh up <E2E_PORT> <env-file> | down' >&2
  exit 2
  ;;
esac

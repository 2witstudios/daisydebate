#!/bin/sh
# pu agent launcher (ADR 0035). .pu/config.yaml runs every agent through this
# script: it exports the machine identity from .env.agent and then becomes
# the agent, so gh and git never act as the owner. It refuses to start an
# agent without a valid identity.
set -eu

env_file=./.env.agent
if [ ! -f "$env_file" ] && [ -n "${PU_PROJECT_ROOT:-}" ]; then
  env_file="$PU_PROJECT_ROOT/.env.agent"
fi
if [ ! -f "$env_file" ]; then
  echo "agent-launch: no .env.agent; copy .env.agent.example and add the machine user token (GRD-6.2)." >&2
  exit 1
fi
# The validated values are exported literally; .env.agent is never sourced,
# so nothing in it is expanded by the shell.
exports=$(bun "$(dirname "$0")/agent-identity.ts" export-env "$env_file")
eval "$exports"
exec "$@"

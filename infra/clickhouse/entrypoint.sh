#!/bin/bash
# Starts ClickHouse, applies each migration once in order, then sweeps
# expired partitions every hour (ADR 0084 §5). The TTL drops a whole day by
# day + 29 once a TTL merge runs; the sweep (sweep.sql) is what bounds every
# row under DEC-42's 30-day ceiling, since a TTL merge has no deadline. Each
# client call has a timeout, so a hung call cannot stall the loop, and only a
# fully successful sweep (sweep.sh) is recorded in daisy_meta.sweeps.
set -euo pipefail

/entrypoint.sh "$@" &
server=$!
trap 'kill -TERM "$server"; wait "$server"; exit 0' TERM INT

ch() { timeout 300 clickhouse-client "$@"; }

until ch -q 'SELECT 1' >/dev/null 2>&1; do
  kill -0 "$server" 2>/dev/null || exit 1
  sleep 1
done

ch --multiquery -q "
  CREATE DATABASE IF NOT EXISTS daisy_logs;
  CREATE DATABASE IF NOT EXISTS daisy_meta;
  CREATE TABLE IF NOT EXISTS daisy_meta.schema_migrations
  (version String, applied_at DateTime('UTC') DEFAULT now())
  ENGINE = MergeTree ORDER BY version;
  CREATE TABLE IF NOT EXISTS daisy_meta.sweeps
  (at DateTime('UTC'), dropped UInt32)
  ENGINE = MergeTree ORDER BY at
  TTL at + INTERVAL 28 DAY DELETE"

for file in /daisy/migrations/*.sql; do
  version=$(basename "$file" .sql)
  applied=$(ch --param_version="$version" \
    -q 'SELECT count() FROM daisy_meta.schema_migrations WHERE version = {version:String}')
  if [ "$applied" = 0 ]; then
    ch --multiquery < "$file"
    ch --param_version="$version" \
      -q 'INSERT INTO daisy_meta.schema_migrations (version) VALUES ({version:String})'
  fi
done

SWEEP_SQL=/daisy/sweep.sql
# shellcheck source=sweep.sh
. /daisy/sweep.sh
(while kill -0 "$server" 2>/dev/null; do
  sweep || echo 'partition sweep failed' >&2
  sleep 3600
done) &

wait "$server"

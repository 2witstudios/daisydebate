#!/bin/bash
# Starts ClickHouse, applies each migration once in order, then sweeps
# expired partitions every hour (ADR 0081). The TTL drops a whole day by
# day + 29; the sweep is the backstop that keeps every row under DEC-42's
# 30-day ceiling even if a TTL merge is late.
set -euo pipefail

/entrypoint.sh "$@" &
server=$!
trap 'kill -TERM "$server"; wait "$server"; exit 0' TERM INT

until clickhouse-client -q 'SELECT 1' >/dev/null 2>&1; do
  kill -0 "$server" 2>/dev/null || exit 1
  sleep 1
done

clickhouse-client --multiquery -q "
  CREATE DATABASE IF NOT EXISTS daisy_logs;
  CREATE DATABASE IF NOT EXISTS daisy_meta;
  CREATE TABLE IF NOT EXISTS daisy_meta.schema_migrations
  (version String, applied_at DateTime('UTC') DEFAULT now())
  ENGINE = MergeTree ORDER BY version"

for file in /daisy/migrations/*.sql; do
  version=$(basename "$file" .sql)
  applied=$(clickhouse-client --param_version="$version" \
    -q 'SELECT count() FROM daisy_meta.schema_migrations WHERE version = {version:String}')
  if [ "$applied" = 0 ]; then
    clickhouse-client --multiquery < "$file"
    clickhouse-client --param_version="$version" \
      -q 'INSERT INTO daisy_meta.schema_migrations (version) VALUES ({version:String})'
  fi
done

sweep() {
  clickhouse-client -q "
    SELECT DISTINCT table, partition_id FROM system.parts
    WHERE database = 'daisy_logs' AND active
      AND toDateOrNull(partition) < today() - 29
    FORMAT TSV" |
    while IFS=$'\t' read -r table partition; do
      clickhouse-client -q "ALTER TABLE daisy_logs.\`$table\` DROP PARTITION ID '$partition'"
    done
}
(while kill -0 "$server" 2>/dev/null; do
  sweep || echo 'partition sweep failed' >&2
  sleep 3600
done) &

wait "$server"

# The hourly retention sweep (ADR 0084 §5), sourced by entrypoint.sh and by
# scripts/clickhouse-sweep.test.ts. It needs `ch` (the timed clickhouse-client)
# and SWEEP_SQL. A sweep is recorded in daisy_meta.sweeps only when the
# partition listing and every drop succeeded; any failure returns non-zero
# without recording, so the Security page reads "unverified".
sweep() {
  local parts table partition dropped=0
  parts=$(ch --param_today="$(date -u +%F)" < "$SWEEP_SQL") || return 1
  while IFS=$'\t' read -r table partition; do
    [ -n "$table" ] || continue
    ch -q "ALTER TABLE daisy_logs.\`$table\` DROP PARTITION ID '$partition'" || return 1
    dropped=$((dropped + 1))
  done <<< "$parts"
  ch --param_dropped="$dropped" \
    -q 'INSERT INTO daisy_meta.sweeps (at, dropped) VALUES (now(), {dropped:UInt32})'
}

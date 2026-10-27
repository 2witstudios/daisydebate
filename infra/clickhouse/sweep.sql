-- The partitions the hourly retention sweep drops (ADR 0084 §5): every
-- daily partition of daisy_logs dated 29 or more days before {today}. A row
-- received at the very start of day D is then at most 29 days and one hour
-- old when the first sweep of day D + 29 drops it, under DEC-42's 30-day
-- ceiling with about 23 hours of margin. entrypoint.sh runs this with
-- today's UTC date; apps/log-shipper/integration/clickhouse.integration.ts
-- runs it with injected dates.
SELECT DISTINCT table, partition_id
FROM system.parts
WHERE database = 'daisy_logs'
  AND active
  AND toDateOrNull(partition) <= {today:Date} - 29
ORDER BY table, partition_id
FORMAT TSV

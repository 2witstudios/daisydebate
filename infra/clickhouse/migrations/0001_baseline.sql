-- The operational log store's baseline (ADR 0081). entrypoint.sh applies
-- each file of this folder once, in order, as the localhost-only `default`
-- user and records it in daisy_logs.schema_migrations; every statement is
-- also idempotent. Retention runs on the shipper's receipt time: 28-day TTL,
-- daily partitions dropped whole, under DEC-42's 30-day ceiling (the hourly
-- partition sweep in entrypoint.sh is the backstop). The `events` columns
-- mirror @daisy/logger's loggableFields one to one
-- (apps/log-shipper/src/rows.test.ts).

CREATE TABLE IF NOT EXISTS daisy_logs.events
(
    received_at DateTime64(3, 'UTC'),
    ts DateTime64(3, 'UTC'),
    app LowCardinality(String),
    region LowCardinality(String),
    instance String,
    service LowCardinality(String),
    app_version LowCardinality(String),
    git_commit String,
    event LowCardinality(String),
    severity Enum8('info' = 1, 'warn' = 2, 'error' = 3),
    operation Nullable(String),
    error_code Nullable(String),
    source Nullable(String),
    source_level Nullable(String),
    close_reason Nullable(String),
    cause Nullable(String),
    invariant_id Nullable(String),
    request_id Nullable(String),
    trace_id Nullable(String),
    user_id Nullable(String),
    actor_id Nullable(String),
    provider_message_id Nullable(String),
    route Nullable(String),
    path Nullable(String),
    client_id_hash Nullable(String),
    duration_ms Nullable(UInt64),
    status Nullable(UInt64),
    port Nullable(UInt64),
    deleted Nullable(UInt64),
    batches Nullable(UInt64),
    close_code Nullable(UInt64),
    delivery_seq_lag_estimate Nullable(UInt64),
    pending Nullable(UInt64),
    scope Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toDate(received_at)
ORDER BY (event, received_at)
TTL toDateTime(received_at) + INTERVAL 28 DAY DELETE
SETTINGS ttl_only_drop_parts = 1, merge_with_ttl_timeout = 3600,
    non_replicated_deduplication_window = 1000;

-- Lines the shipper refused, counted per minute, app and closed reason;
-- never their content.
CREATE TABLE IF NOT EXISTS daisy_logs.shipper_drops
(
    minute DateTime('UTC'),
    app LowCardinality(String),
    reason LowCardinality(String),
    count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toDate(minute)
ORDER BY (minute, app, reason)
TTL minute + INTERVAL 28 DAY DELETE
SETTINGS ttl_only_drop_parts = 1, merge_with_ttl_timeout = 3600,
    non_replicated_deduplication_window = 1000;

-- The shipper's own liveness, independent of any event count: one row a
-- minute while it runs.
CREATE TABLE IF NOT EXISTS daisy_logs.shipper_heartbeats
(
    at DateTime('UTC'),
    nats_state LowCardinality(String),
    reconnects UInt64,
    buffered UInt64,
    pending_tallies UInt64
)
ENGINE = MergeTree
PARTITION BY toDate(at)
ORDER BY at
TTL at + INTERVAL 28 DAY DELETE
SETTINGS ttl_only_drop_parts = 1, merge_with_ttl_timeout = 3600,
    non_replicated_deduplication_window = 1000;

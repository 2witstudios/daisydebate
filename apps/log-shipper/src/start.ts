import { connect } from '@nats-io/transport-node';
import { systemClock, systemId } from '@daisy/clock';
import { createLogger } from '@daisy/logger';
import { createClickHouseSink } from './clickhouse-sink';
import { readShipperConfig, subscriptionsFor } from './config';
import { createNatsHealth } from './health';
import { createShipBuffer, flush } from './ship';

// The deployment edge (ADR 0084): Fly's org log stream in, ClickHouse out.
const FLUSH_INTERVAL_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_BATCH = 1_000;
const CAPACITY = 5_000;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
// A drain that outlasts this exits anyway (fly.log-shipper.toml kill_timeout).
const SHUTDOWN_DEADLINE_MS = 10_000;

const config = readShipperConfig(process.env);
const logger = createLogger({
  service: 'log-shipper',
  appVersion: config.APP_VERSION,
  gitCommit: config.GIT_COMMIT,
});
const sink = createClickHouseSink({
  url: config.CLICKHOUSE_URL,
  password: config.CLICKHOUSE_SHIPPER_PASSWORD,
});
const buffer = createShipBuffer({
  apps: new Set(config.SHIPPER_APPS),
  capacity: CAPACITY,
  maxBytes: MAX_BUFFERED_BYTES,
  clock: systemClock,
  ids: systemId,
});
const health = createNatsHealth();
const nats = await connect({
  servers: config.NATS_URL,
  user: config.FLY_ORG,
  pass: config.NATS_TOKEN,
  name: 'daisy-log-shipper',
  maxReconnectAttempts: -1,
});
void (async () => {
  for await (const status of nats.status()) health.observe(status);
})();
// Callback subscriptions: each record is classified as it arrives, so the
// client holds no queue of unread messages.
for (const { subject, queue } of subscriptionsFor(config.SHIPPER_APPS))
  nats.subscribe(subject, {
    queue,
    callback: (error, message) => {
      if (!error) buffer.receive(message.subject, message.data);
    },
  });
logger.log('logship.started', {}, 'Log shipper started');

let stopping = false;
// Resolves on SIGTERM or SIGINT, so a backoff sleep of up to 30 s never
// eats the shutdown budget before the drain.
let wake: () => void = () => undefined;
const stopped = new Promise<void>((resolve) => {
  wake = resolve;
});
const stop = () => {
  stopping = true;
  wake();
  setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

const beat = async () => {
  try {
    await sink.insertHeartbeat(health.heartbeat(systemClock.now(), buffer));
  } catch {
    // The missing heartbeat is itself the signal the admin page shows.
  }
};
let delay = FLUSH_INTERVAL_MS;
let lastBeat = 0;
while (!stopping) {
  await Promise.race([Bun.sleep(delay), stopped]);
  if (stopping) break;
  const result = await flush({ buffer, sink, logger, maxBatch: MAX_BATCH });
  delay =
    result === 'failed'
      ? Math.min(delay * 2, MAX_BACKOFF_MS)
      : FLUSH_INTERVAL_MS;
  const now = Date.parse(systemClock.now());
  if (now - lastBeat >= HEARTBEAT_INTERVAL_MS) {
    lastBeat = now;
    await beat();
  }
}
// Shutdown: stop receiving, send what is buffered while ClickHouse accepts
// it, then close. Fly's kill_timeout bounds the whole drain.
await nats.drain();
while ((await flush({ buffer, sink, logger, maxBatch: MAX_BATCH })) === 'sent');
await sink.close();
process.exit(0);

import type { Clock, IdGenerator } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { admitLogLine, type DropReason } from '@daisy/logger/ingest';
import { parseEnvelope } from './envelope';
import { toEventRow, type EventRow } from './rows';

/**
 * Why a stream record was not stored (ADR 0081): the logger's own reasons,
 * plus an oversized record, a malformed envelope, one that disagrees with
 * its subject (`placement`), an app outside the configured list, a source
 * time too far from receipt, and a full buffer. A record is never kept in any raw form.
 */
export type ShipDropReason =
  | DropReason
  | 'size'
  | 'envelope'
  | 'placement'
  | 'app'
  | 'time'
  | 'backpressure';
export type DropRow = {
  readonly minute: string;
  readonly app: string;
  readonly reason: ShipDropReason;
  readonly count: number;
};
/** One insert unit; `id` is its deduplication token on every retry. */
export type Batch = {
  readonly id: string;
  readonly rows: readonly EventRow[];
  readonly drops: readonly DropRow[];
};
export type Sink = {
  readonly insertRows: (
    rows: readonly EventRow[],
    token: string,
  ) => Promise<void>;
  readonly insertDrops: (
    drops: readonly DropRow[],
    token: string,
  ) => Promise<void>;
};

/** Fly's record ceiling here, checked before any byte is decoded. */
export const MAX_RECORD_BYTES = 16_384;
/** How far a source time may sit from receipt: 5 min ahead, 1 h behind. */
const MAX_AHEAD_MS = 5 * 60_000;
const MAX_BEHIND_MS = 60 * 60_000;

type Classified =
  | { readonly kind: 'row'; readonly row: EventRow; readonly bytes: number }
  | {
      readonly kind: 'drop';
      readonly app: string;
      readonly reason: ShipDropReason;
    };

const drop = (app: string, reason: ShipDropReason): Classified => ({
  kind: 'drop',
  app,
  reason,
});

/**
 * One stream record's fate. The subject (`logs.<app>.<region>.<instance>`)
 * is the broker's, so the envelope must agree with it; retention runs on
 * the receipt time, so a source time far from it is refused rather than
 * stored.
 */
export function classify({
  subject,
  data,
  apps,
  receivedAt,
}: {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly apps: ReadonlySet<string>;
  readonly receivedAt: string;
}): Classified {
  const placement = subjectPlacement(subject, apps);
  if (!placement) return drop('unknown', 'app');
  const { app } = placement;
  if (data.byteLength > MAX_RECORD_BYTES) return drop(app, 'size');
  const record = parseEnvelope(new TextDecoder().decode(data));
  if (!record) return drop(app, 'envelope');
  if (!samePlacement(record, placement)) return drop(app, 'placement');
  const admitted = admitLogLine(record.message);
  if (!admitted.ok) return drop(app, admitted.reason);
  if (!nearReceipt(admitted.entry.at, receivedAt)) return drop(app, 'time');
  return {
    kind: 'row',
    row: toEventRow(record, admitted.entry, receivedAt),
    bytes: record.message.length,
  };
}

type Placement = {
  readonly app: string;
  readonly region?: string;
  readonly instance?: string;
};

/**
 * The broker's placement of a record, for a configured app only. Fly's
 * stream delivers each record under the subscription's own subject
 * (`logs.<app>.>`), so the app is always attested; a concrete
 * `logs.<app>.<region>.<instance>` subject also attests the rest.
 */
const subjectPlacement = (
  subject: string,
  apps: ReadonlySet<string>,
): Placement | null => {
  const [prefix, app = '', ...rest] = subject.split('.');
  if (prefix !== 'logs' || !apps.has(app)) return null;
  if (rest.length === 1 && rest[0] === '>') return { app };
  const [region, instance] = rest;
  return rest.length === 2 && region && instance
    ? { app, region, instance }
    : null;
};

const samePlacement = (record: Placement, placement: Placement) =>
  record.app === placement.app &&
  (placement.region === undefined || record.region === placement.region) &&
  (placement.instance === undefined || record.instance === placement.instance);

const nearReceipt = (at: string, receivedAt: string) => {
  const skew = Date.parse(at) - Date.parse(receivedAt);
  return skew <= MAX_AHEAD_MS && skew >= -MAX_BEHIND_MS;
};

/** ClickHouse DateTime text for the UTC minute an ISO instant falls in. */
const minuteOf = (instant: string) =>
  `${instant.slice(0, 16).replace('T', ' ')}:00`;

/**
 * The rows waiting for ClickHouse, capped by count and by line bytes, and
 * the drop tallies, keyed by (app, reason) only so an outage of any length
 * keeps at most (apps + 1) × reasons of them. A tally is stamped with the
 * minute it is taken. The batch in flight is kept whole until both its
 * inserts succeed, so a retry resends exactly the same rows under the same
 * token and ClickHouse stores them once.
 */
export function createShipBuffer({
  apps,
  capacity,
  maxBytes,
  clock,
  ids,
}: {
  readonly apps: ReadonlySet<string>;
  readonly capacity: number;
  readonly maxBytes: number;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}) {
  let rows: { readonly row: EventRow; readonly bytes: number }[] = [];
  let bytes = 0;
  let tallies = new Map<
    string,
    { app: string; reason: ShipDropReason; count: number }
  >();
  let inflight: (Batch & { rowsStored: boolean }) | null = null;
  const count = (app: string, reason: ShipDropReason) => {
    const key = `${app}|${reason}`;
    const tally = tallies.get(key) ?? { app, reason, count: 0 };
    tally.count += 1;
    tallies.set(key, tally);
  };
  return {
    receive(subject: string, data: Uint8Array) {
      const result = classify({ subject, data, apps, receivedAt: clock.now() });
      if (result.kind === 'drop') count(result.app, result.reason);
      else if (rows.length >= capacity || bytes + result.bytes > maxBytes)
        count(String(result.row.app), 'backpressure');
      else {
        rows.push(result);
        bytes += result.bytes;
      }
    },
    /** The batch to send: the one in flight, or up to `max` new rows and every tally. */
    next(max: number) {
      if (inflight) return inflight;
      if (rows.length === 0 && tallies.size === 0) return null;
      const minute = minuteOf(clock.now());
      const taken = rows.slice(0, max);
      rows = rows.slice(max);
      bytes -= taken.reduce((sum, entry) => sum + entry.bytes, 0);
      inflight = {
        id: ids.next(),
        rows: taken.map((entry) => entry.row),
        drops: [...tallies.values()].map((tally) => ({ minute, ...tally })),
        rowsStored: false,
      };
      tallies = new Map();
      return inflight;
    },
    rowsStored() {
      if (inflight) inflight.rowsStored = true;
    },
    settle() {
      inflight = null;
    },
    /** Rows waiting, the batch in flight included. */
    size: () =>
      rows.length + (inflight?.rowsStored ? 0 : (inflight?.rows.length ?? 0)),
    pendingTallies: () => tallies.size + (inflight?.drops.length ?? 0),
  };
}
export type ShipBuffer = ReturnType<typeof createShipBuffer>;

/**
 * Sends the batch in flight: rows, then tallies, each under its own
 * deduplication token and only when present. A failure leaves the batch in
 * flight for the next attempt and is logged with the backlog size only,
 * never the rows or the error text.
 */
export async function flush({
  buffer,
  sink,
  logger,
  maxBatch,
}: {
  readonly buffer: ShipBuffer;
  readonly sink: Sink;
  readonly logger: Logger;
  readonly maxBatch: number;
}): Promise<'idle' | 'sent' | 'failed'> {
  const batch = buffer.next(maxBatch);
  if (!batch) return 'idle';
  try {
    if (!batch.rowsStored && batch.rows.length > 0)
      await sink.insertRows(batch.rows, `${batch.id}-rows`);
    buffer.rowsStored();
    if (batch.drops.length > 0)
      await sink.insertDrops(batch.drops, `${batch.id}-drops`);
    buffer.settle();
    return 'sent';
  } catch {
    logger.log(
      'logship.insert.failed',
      { errorCode: 'INFRASTRUCTURE', pending: buffer.size() },
      'Log batch insert failed',
    );
    return 'failed';
  }
}

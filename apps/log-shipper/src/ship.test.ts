import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createLogger } from '@daisy/logger';
import type { EventRow } from './rows';
import { createShipBuffer, flush, type DropRow } from './ship';
import {
  app,
  apps,
  line,
  receivedAt,
  record,
  subject,
  valid,
} from './ship.test-support';

setupRitewayBun();

const bufferOf = (capacity = 10, maxBytes = 1_000_000) =>
  createShipBuffer({
    apps,
    capacity,
    maxBytes,
    clock: fixedClock(receivedAt),
    ids: sequentialId('batch'),
  });
const silent = () => {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({
      service: 'log-shipper',
      destination: { write: (text) => lines.push(text) },
    }),
  };
};
const recordingSink = () => {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      insertRows: async (rows: readonly EventRow[], token: string) =>
        void calls.push(`rows:${rows.length}:${token}`),
      insertDrops: async (drops: readonly DropRow[], token: string) =>
        void calls.push(`drops:${drops.length}:${token}`),
    },
  };
};

describe('ship buffer', () => {
  test('keeps rows and tallies drops per app and reason, stamped when taken', () => {
    const buffer = bufferOf();
    buffer.receive(subject, valid);
    buffer.receive(subject, valid);
    buffer.receive(subject, record('not json'));
    buffer.receive(subject, record('still not json'));
    buffer.receive('logs.elsewhere.ord.811006b93572d8', valid);
    const batch = buffer.next(100);
    assert({
      given: 'two admitted lines, two non-JSON lines and a foreign app',
      should: 'batch the rows and one tally per (app, reason)',
      actual: {
        id: batch?.id,
        rows: batch?.rows.map((row) => [row.event, row.status]),
        drops: batch?.drops,
      },
      expected: {
        id: 'batch-1',
        rows: [
          ['auth.rate_limit.denied', 429],
          ['auth.rate_limit.denied', 429],
        ],
        drops: [
          { minute: '2026-10-27 13:01:00', app, reason: 'json', count: 2 },
          {
            minute: '2026-10-27 13:01:00',
            app: 'unknown',
            reason: 'app',
            count: 1,
          },
        ],
      },
    });
  });

  test('counts arrivals past the row or byte cap as backpressure', () => {
    const byRows = bufferOf(1);
    byRows.receive(subject, valid);
    byRows.receive(subject, valid);
    const byBytes = bufferOf(10, JSON.stringify(line).length + 1);
    byBytes.receive(subject, valid);
    byBytes.receive(subject, valid);
    const summary = (batch: ReturnType<typeof byRows.next>) => ({
      rows: batch?.rows.length,
      drops: batch?.drops.map((drop) => [drop.reason, drop.count]),
    });
    assert({
      given: 'a buffer full by rows and one full by bytes',
      should: 'keep what fits and count the rest as backpressure',
      actual: [summary(byRows.next(10)), summary(byBytes.next(10))],
      expected: [
        { rows: 1, drops: [['backpressure', 1]] },
        { rows: 1, drops: [['backpressure', 1]] },
      ],
    });
  });

  test('stays bounded through a long outage', () => {
    const buffer = bufferOf(5, 1_000_000);
    for (let index = 0; index < 1_000; index += 1) {
      buffer.receive(subject, valid);
      buffer.receive(subject, record('not json'));
      buffer.receive('logs.elsewhere.ord.811006b93572d8', valid);
    }
    assert({
      given: 'a thousand rounds of rows and drops with nothing sent',
      should: 'hold at most capacity rows and one tally per (app, reason)',
      actual: { size: buffer.size(), tallies: buffer.pendingTallies() },
      expected: { size: 5, tallies: 3 },
    });
  });
});

describe('flush', () => {
  test('sends nothing when idle', async () => {
    const { calls, sink } = recordingSink();
    const result = await flush({
      buffer: bufferOf(),
      sink,
      logger: silent().logger,
      maxBatch: 10,
    });
    assert({
      given: 'an empty buffer',
      should: 'report idle without calling the sink',
      actual: { result, calls },
      expected: { result: 'idle', calls: [] },
    });
  });

  test('sends rows then tallies, each under the batch token', async () => {
    const buffer = bufferOf();
    buffer.receive(subject, valid);
    buffer.receive(subject, record('not json'));
    const { calls, sink } = recordingSink();
    const result = await flush({
      buffer,
      sink,
      logger: silent().logger,
      maxBatch: 10,
    });
    assert({
      given: 'a buffered row and a tally',
      should: 'insert both under their tokens and settle the batch',
      actual: { result, calls, next: buffer.next(10) },
      expected: {
        result: 'sent',
        calls: ['rows:1:batch-1-rows', 'drops:1:batch-1-drops'],
        next: null,
      },
    });
  });

  test('retries a failed batch whole, under the same token, and logs no error text', async () => {
    const buffer = bufferOf();
    buffer.receive(subject, valid);
    const { lines, logger } = silent();
    const tokens: string[] = [];
    let fail = true;
    const sink = {
      insertRows: async (rows: readonly EventRow[], token: string) => {
        tokens.push(`${rows.length}:${token}`);
        if (fail) throw new Error('connect ECONNREFUSED [fdaa::1]:8123 secret');
      },
      insertDrops: async () => undefined,
    };
    const first = await flush({ buffer, sink, logger, maxBatch: 10 });
    buffer.receive(subject, valid);
    fail = false;
    const second = await flush({ buffer, sink, logger, maxBatch: 10 });
    const third = await flush({ buffer, sink, logger, maxBatch: 10 });
    const logged = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    assert({
      given: 'a sink that fails once while another line arrives',
      should:
        'resend the same one-row batch under its token, then send the new row in its own batch',
      actual: {
        results: [first, second, third],
        tokens,
        event: logged.event,
        pending: logged.pending,
        leaked: lines.join('').includes('ECONNREFUSED'),
      },
      expected: {
        results: ['failed', 'sent', 'sent'],
        tokens: ['1:batch-1-rows', '1:batch-1-rows', '1:batch-2-rows'],
        event: 'logship.insert.failed',
        pending: 1,
        leaked: false,
      },
    });
  });

  test('retries only the tallies when the rows were stored', async () => {
    const buffer = bufferOf();
    buffer.receive(subject, valid);
    buffer.receive(subject, record('not json'));
    const calls: string[] = [];
    let fail = true;
    const sink = {
      insertRows: async (_rows: readonly EventRow[], token: string) =>
        void calls.push(token),
      insertDrops: async (_drops: readonly DropRow[], token: string) => {
        calls.push(token);
        if (fail) throw new Error('timeout');
      },
    };
    const logger = silent().logger;
    const first = await flush({ buffer, sink, logger, maxBatch: 10 });
    fail = false;
    const second = await flush({ buffer, sink, logger, maxBatch: 10 });
    assert({
      given: 'rows that insert and tallies that fail once',
      should: 'store the rows once and resend only the tallies',
      actual: { results: [first, second], calls },
      expected: {
        results: ['failed', 'sent'],
        calls: ['batch-1-rows', 'batch-1-drops', 'batch-1-drops'],
      },
    });
  });
});

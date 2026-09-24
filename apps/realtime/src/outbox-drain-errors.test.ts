import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { OUTBOX_ORIGIN, type OutboxRow } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createOutboxDrainLoop } from './outbox-drain';

setupRitewayBun();

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function recordingLogger(): {
  readonly logger: Logger;
  readonly events: string[];
} {
  const events: string[] = [];
  const logger: Logger = {
    log: (event) => {
      events.push(event);
    },
    child: () => logger,
  };
  return { logger, events };
}

const fakeRow = (seq: bigint): OutboxRow => ({
  txid: '1',
  seq,
  topic: 'debate:fake',
  kind: 'debate.phase-changed',
  version: 1,
  payload: { entityVersion: 1, kind: 'debate.phase-changed', ids: ['fake'] },
  createdAt: '2026-09-23T00:00:00.000Z',
});

describe('createOutboxDrainLoop error recovery (RT-2.3b review finding 1)', () => {
  test('a rejecting drainOutbox query is caught, logged, and never crashes the loop; the next poll retries and succeeds', async () => {
    const { logger, events } = recordingLogger();
    let call = 0;
    const drainOutbox = async (): Promise<readonly OutboxRow[]> => {
      call += 1;
      if (call === 1) throw new Error('connection reset');
      return [];
    };
    const delivered: (readonly OutboxRow[])[] = [];
    const loop = createOutboxDrainLoop({
      drainOutbox,
      sink: (rows) => {
        delivered.push(rows);
      },
      initialCursor: OUTBOX_ORIGIN,
      logger,
    });

    let unhandled: unknown;
    const onUnhandled = (error: unknown) => {
      unhandled = error;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      loop.wake();
      await flush();
      loop.poll();
      await flush();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    assert({
      given: 'a drainOutbox query that rejects once, then a poll that succeeds',
      should:
        'log the failure once, raise no unhandled rejection, and let the next poll deliver normally',
      actual: {
        callCount: call,
        loggedDrainFailure: events.includes('realtime.outbox.drain_failed'),
        unhandled,
        cursorAfter: loop.cursor(),
      },
      expected: {
        callCount: 2,
        loggedDrainFailure: true,
        unhandled: undefined,
        cursorAfter: OUTBOX_ORIGIN,
      },
    });
  });

  test('a throwing sink is caught, logged, and leaves the cursor at the last range the sink accepted, so the next wakeup retries the same range', async () => {
    const { logger, events } = recordingLogger();
    const row = fakeRow(1n);
    let sinkCalls = 0;
    const sink = (_rows: readonly OutboxRow[]) => {
      sinkCalls += 1;
      if (sinkCalls === 1) throw new Error('socket write failed');
    };
    const drainOutbox = async (): Promise<readonly OutboxRow[]> => [row];
    const loop = createOutboxDrainLoop({
      drainOutbox,
      sink,
      initialCursor: OUTBOX_ORIGIN,
      logger,
    });

    let unhandled: unknown;
    const onUnhandled = (error: unknown) => {
      unhandled = error;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      loop.wake();
      await flush();
      const cursorAfterFailure = loop.cursor();
      loop.poll();
      await flush();

      assert({
        given:
          'a sink that throws on its first call, then accepts the same row on retry',
        should:
          'never advance the cursor past a range the sink rejected, log the failure, and accept it once the sink succeeds',
        actual: {
          cursorAfterFailure,
          sinkCalls,
          cursorAfterRetry: loop.cursor(),
          loggedDrainFailure: events.includes('realtime.outbox.drain_failed'),
          unhandled,
        },
        expected: {
          cursorAfterFailure: OUTBOX_ORIGIN,
          sinkCalls: 2,
          cursorAfterRetry: { txid: row.txid, seq: row.seq },
          loggedDrainFailure: true,
          unhandled: undefined,
        },
      });
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

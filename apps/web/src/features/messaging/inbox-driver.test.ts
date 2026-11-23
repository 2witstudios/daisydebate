import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol/realtime-server';
import { ENVELOPE_VERSION } from '@daisy/protocol/realtime';
import { buildUserInboxTopic } from '@daisy/protocol/topics';
import type { ConnectionPhase } from '../realtime/connection-status';
import type { SyncConnection } from '../resource-sync/driver';
import { createInboxDriver, seedInbox } from './inbox-driver';
import type { MessagingInboxPageAnswer } from './inbox-view';

setupRitewayBun();

const actorId = 'a'.repeat(24);
const channel = (n: number) => `c${String(n).padStart(23, '0')}`;
const entry = (n: number) => ({
  channelId: channel(n),
  kind: 'conversation' as const,
  title: `Chat ${n}`,
  preview: null,
  activityAt: '2026-11-20T10:00:00.000Z',
  unread: false,
});

/** A realtime connection the test drives: topic frames and phase changes. */
const fakeConnection = (log: string[]) => {
  const topics = new Map<string, (frame: ServerMessage) => void>();
  const phases = new Set<(phase: ConnectionPhase) => void>();
  const connection = {
    subscribeTopic: (
      topic: string,
      listener: (frame: ServerMessage) => void,
    ) => {
      log.push(`subscribe ${topic}`);
      topics.set(topic, listener);
      return () => {
        log.push(`unsubscribe ${topic}`);
        topics.delete(topic);
      };
    },
    onMessage: () => () => {},
    resubscribeTopic: (topic: string) => log.push(`resubscribe ${topic}`),
    subscribe: (listener: (phase: ConnectionPhase) => void) => {
      phases.add(listener);
      return () => phases.delete(listener);
    },
    connect: () => log.push('connect'),
    dispose: () => log.push('dispose'),
  } as unknown as SyncConnection;
  return {
    connection,
    ring: (topic: string) =>
      topics.get(topic)?.({
        v: ENVELOPE_VERSION,
        type: 'event',
        topic,
        position: '1:2',
        payload: { kind: 'messaging.inbox.changed' },
      } as ServerMessage),
    phase: (phase: ConnectionPhase) => {
      for (const listener of phases) listener(phase);
    },
  };
};

const start = (
  answer: (query: {
    readonly q: string | null;
    readonly after: string | null;
  }) => MessagingInboxPageAnswer | null = () => ({
    entries: [entry(2)],
    nextAfter: null,
  }),
) => {
  const clock = virtualClock();
  const log: string[] = [];
  const reads: string[] = [];
  const sockets: ReturnType<typeof fakeConnection>[] = [];
  const driver = createInboxDriver({
    seed: seedInbox({
      entries: [entry(1)],
      nextAfter: null,
      now: '2026-11-20T10:05:00.000Z',
    }),
    readPage: async (query) => {
      reads.push(`${query.q ?? '-'} ${query.after ?? '-'}`);
      return answer(query);
    },
    scheduler: {
      after: (run, ms) => {
        const waiting = new AbortController();
        void clock.sleep(ms, waiting.signal).then(() => {
          if (!waiting.signal.aborted) run();
        });
        return () => waiting.abort();
      },
    },
    now: () => `measured at ${clock.nowMs()}`,
    connect: (socketUrl) => {
      log.push(`open ${socketUrl}`);
      const socket = fakeConnection(log);
      sockets.push(socket);
      return socket.connection;
    },
  });
  let changes = 0;
  driver.subscribe(() => changes++);
  return { clock, driver, log, reads, sockets, changes: () => changes };
};

describe('inbox driver', () => {
  test('a doorbell ring re-reads after the coalescing wait', async () => {
    const { clock, driver, log, reads, sockets } = start();
    driver.follow({ actorId, socketUrl: 'wss://rt.test/a' });
    sockets[0]!.ring(buildUserInboxTopic(actorId));
    sockets[0]!.ring(buildUserInboxTopic(actorId));
    await clock.advance(749);
    const early = reads.length;
    await clock.advance(1);
    assert({
      given: 'two rings on the member inbox topic',
      should: 'open the socket once and read once, 750 ms later',
      actual: {
        log,
        early,
        reads,
        snapshot: driver.readSnapshot(),
      },
      expected: {
        log: [
          'open wss://rt.test/a',
          `subscribe ${buildUserInboxTopic(actorId)}`,
          'connect',
        ],
        early: 0,
        reads: ['- -'],
        snapshot: {
          entries: [entry(2)],
          nextAfter: null,
          now: 'measured at 750',
          available: true,
          search: '',
          appliedSearch: null,
        },
      },
    });
  });

  test('a dropped connection rings; a left or disposed one does not', async () => {
    const { clock, driver, reads, sockets } = start();
    driver.follow({ actorId, socketUrl: 'wss://rt.test/a' });
    sockets[0]!.phase({ status: 'closed', why: 'left' });
    await clock.advance(1000);
    const quiet = reads.length;
    sockets[0]!.phase({ status: 'closed', why: 'revoked' });
    await clock.advance(750);
    assert({
      given: 'a connection that is left, then closed for a reason',
      should: 'read only after the closing with a reason',
      actual: { quiet, reads: reads.length },
      expected: { quiet: 0, reads: 1 },
    });
  });

  test('listening elsewhere replaces the socket; the same place keeps it', () => {
    const { driver, log } = start();
    driver.follow({ actorId, socketUrl: 'wss://rt.test/a' });
    driver.follow({ actorId, socketUrl: 'wss://rt.test/a' });
    driver.follow({ actorId, socketUrl: 'wss://rt.test/b' });
    driver.follow(null);
    assert({
      given: 'the same socket twice, then another, then none',
      should: 'open each socket once and close each one it leaves',
      actual: log.filter((line) => /^(open|dispose)/.test(line)),
      expected: [
        'open wss://rt.test/a',
        'dispose',
        'open wss://rt.test/b',
        'dispose',
      ],
    });
  });

  test('a search is applied only when its answer arrives', async () => {
    const { clock, driver, reads } = start(({ q }) =>
      q === 'ada' ? { entries: [entry(3)], nextAfter: null } : null,
    );
    driver.setSearch('ada ');
    const typed = driver.readSnapshot();
    await clock.advance(250);
    assert({
      given: 'a typed search',
      should: 'show the typing at once and the answer after 250 ms',
      actual: {
        typed: [typed.search, typed.appliedSearch, typed.entries.length],
        reads,
        after: driver.readSnapshot(),
      },
      expected: {
        typed: ['ada ', null, 1],
        reads: ['ada -'],
        after: {
          entries: [entry(3)],
          nextAfter: null,
          now: 'measured at 250',
          available: true,
          search: 'ada ',
          appliedSearch: 'ada',
        },
      },
    });
  });

  test('more appends; a refused page leaves the list', async () => {
    let refuse = false;
    const { driver } = start(() =>
      refuse ? null : { entries: [entry(4)], nextAfter: 'x~y' },
    );
    const read = await driver.more('after-1');
    refuse = true;
    const refused = await driver.more('after-2');
    assert({
      given: 'a page that reads and one that does not',
      should: 'append the first and answer false for the second',
      actual: {
        read,
        refused,
        channels: driver.readSnapshot().entries.map((row) => row.channelId),
        nextAfter: driver.readSnapshot().nextAfter,
        now: driver.readSnapshot().now,
      },
      expected: {
        read: true,
        refused: false,
        channels: [channel(1), channel(4)],
        nextAfter: 'x~y',
        now: '2026-11-20T10:05:00.000Z',
      },
    });
  });

  test('dispose closes the socket and ends every wait', async () => {
    const { clock, driver, log, reads, changes } = start();
    driver.follow({ actorId, socketUrl: 'wss://rt.test/a' });
    driver.ring();
    driver.dispose();
    await clock.advance(10_000);
    assert({
      given: 'a ring waiting when the inbox leaves the page',
      should: 'read nothing more and release the socket',
      actual: { reads, closed: log.includes('dispose'), changes: changes() },
      expected: { reads: [], closed: true, changes: 0 },
    });
  });
});

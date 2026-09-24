import { SQL } from 'bun';
import { assert, test, setupRitewayBun } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { systemId } from '@daisy/clock';
import type { OutboxRow } from '@daisy/db';
import { buildDebateTopic } from '@daisy/protocol';
import {
  bootServer,
  databaseUrl,
  insertAndNotifyBurst,
  insertOutboxRow,
  notifyOutbox,
  waitFor,
} from './support';

setupRitewayBun();

requireTestServices(process.env);

test('a burst of notifications for many committed, distinct-payload rows produces at most 2 range queries relevant to it, never one per event', async () => {
  const delivered: OutboxRow[] = [];
  const BURST_SIZE = 30;
  const topic = buildDebateTopic(systemId.next());
  // Counted from the sink, not from a global query tally (RT-2.3b-f1
  // criterion 2): `bun test:integration` runs this suite and @daisy/db's
  // concurrently under turbo, and both append to and NOTIFY the same
  // shared slot database's `outbox` channel. A query triggered by another
  // suite's traffic that returns none of this topic's rows is real
  // background activity, not an extra query "spent" delivering this
  // burst, so it must not count against the bound.
  let relevantQueries = 0;
  // A long poll interval isolates the NOTIFY path: any query observed here
  // comes from coalesced wakeups, not the correctness-mechanism poll.
  const { close } = await bootServer({
    sink: (rows) => {
      delivered.push(...rows);
      if (rows.some((row) => row.topic === topic)) relevantQueries += 1;
    },
    pollIntervalMs: 60_000,
  });
  const client = new SQL(databaseUrl);
  try {
    // One transaction, distinct payloads: PostgreSQL folds identical NOTIFY
    // payloads sent in one transaction into a single delivery, so this is
    // what actually proves a burst rather than de-duplication.
    await insertAndNotifyBurst(client, topic, BURST_SIZE);

    await waitFor(
      () =>
        delivered.filter((row) => row.topic === topic).length === BURST_SIZE,
    );

    assert({
      given: `${BURST_SIZE} committed rows with distinct payloads, notified together in one transaction, on a shared database other suites are also using`,
      should:
        'deliver every row via at most 2 coalesced range queries that actually carried one of its rows, never one per notification',
      actual: {
        deliveredCount: delivered.filter((row) => row.topic === topic).length,
        queriesAtMostTwo: relevantQueries <= 2,
      },
      expected: { deliveredCount: BURST_SIZE, queriesAtMostTwo: true },
    });
  } finally {
    await client.unsafe('delete from outbox where topic = $1', [topic]);
    await client.close();
    await close();
  }
});

test('no notifications still delivers within the poll interval, since the poll is the correctness mechanism, not a fallback', async () => {
  const delivered: OutboxRow[] = [];
  const { close } = await bootServer({
    sink: (rows) => {
      delivered.push(...rows);
    },
    pollIntervalMs: 50,
  });
  const client = new SQL(databaseUrl);
  const topic = buildDebateTopic(systemId.next());
  try {
    // No pg_notify call: only the poll can ever see this row.
    await insertOutboxRow(client, {
      topic,
      kind: 'debate.phase-changed',
      version: 1,
      payload: { entityVersion: 1, kind: 'debate.phase-changed', ids: [topic] },
    });

    await waitFor(() => delivered.some((row) => row.topic === topic), 2000);

    assert({
      given: 'a committed row with no NOTIFY ever sent for it',
      should: 'still be delivered by the next 1 s-scale poll tick',
      actual: delivered.filter((row) => row.topic === topic).length,
      expected: 1,
    });
  } finally {
    await client.unsafe('delete from outbox where topic = $1', [topic]);
    await client.close();
    await close();
  }
});

test('a LISTEN reconnect drains from the in-memory cursor, missing nothing', async () => {
  const delivered: OutboxRow[] = [];
  const tag = `rt_reconnect_${systemId.next().slice(0, 10)}`;
  let listenWakeCount = 0;
  // The poll is disabled for the length of this test (60 s) so that any
  // delivery observed here can only come from the reconnect's own wakeup,
  // isolating that claim from the correctness-mechanism poll, which would
  // otherwise mask a missed reconnect.
  const { close } = await bootServer({
    sink: (rows) => {
      delivered.push(...rows);
    },
    pollIntervalMs: 60_000,
    applicationNameTag: tag,
    onListenWake: () => {
      listenWakeCount += 1;
    },
  });
  const client = new SQL(databaseUrl);
  const killer = new SQL(databaseUrl);
  const topicBefore = buildDebateTopic(systemId.next());
  const topicAfter = buildDebateTopic(systemId.next());
  try {
    const before = await insertOutboxRow(client, {
      topic: topicBefore,
      kind: 'debate.phase-changed',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'debate.phase-changed',
        ids: [topicBefore],
      },
    });
    await notifyOutbox(client, before);
    await waitFor(() => delivered.some((row) => row.topic === topicBefore));

    const listenWakesBeforeKill = listenWakeCount;
    await killer.unsafe(
      'select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and pid <> pg_backend_pid()',
      [tag],
    );

    // Independent of any content on the shared database (RT-2.3b-f1
    // criterion 2): `onListenWake` fires only for this connection's own
    // subscription, so it cannot be satisfied by another suite's NOTIFY
    // traffic the way an end-to-end delivery check could.
    await waitFor(() => listenWakeCount > listenWakesBeforeKill, 15_000);

    // A row committed and notified while the listen connection is down (or
    // still reconnecting) can have its NOTIFY lost by design (ADR 0032 §3);
    // only the reconnect's catch-up wake, never the poll (disabled above),
    // may deliver it in this test.
    const after = await insertOutboxRow(client, {
      topic: topicAfter,
      kind: 'debate.phase-changed',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'debate.phase-changed',
        ids: [topicAfter],
      },
    });
    await notifyOutbox(client, after);

    await waitFor(
      () => delivered.some((row) => row.topic === topicAfter),
      15_000,
    );

    assert({
      given:
        'the LISTEN connection killed after one row is delivered, then a second row committed and notified',
      should:
        'reconnect (observed independently of any other traffic), catch up from the in-memory cursor via onlisten, and deliver the second row too',
      actual: {
        reconnectedOwnConnection: listenWakeCount > listenWakesBeforeKill,
        firstDelivered: delivered.some((row) => row.topic === topicBefore),
        secondDelivered: delivered.some((row) => row.topic === topicAfter),
      },
      expected: {
        reconnectedOwnConnection: true,
        firstDelivered: true,
        secondDelivered: true,
      },
    });
  } finally {
    await client.unsafe('delete from outbox where topic = $1', [topicBefore]);
    await client.unsafe('delete from outbox where topic = $1', [topicAfter]);
    await client.close();
    await killer.close();
    await close();
  }
}, 20_000);

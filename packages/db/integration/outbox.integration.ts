import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestOnlyOperations } from '../src/test-only-operations';
import {
  OUTBOX_ORIGIN,
  appendOutboxEvent,
  decodeOutboxCursor,
  drainOutbox,
} from '../src/outbox';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * The NOTIFY payloads a LISTEN connection receives, and a promise that
 * resolves from the LISTEN callback itself once one matches: no polling.
 */
const notificationLog = () => {
  const received: string[] = [];
  const waiters: Array<{
    readonly matches: (payload: string) => boolean;
    readonly resolve: () => void;
  }> = [];
  return {
    record: (payload: string) => {
      received.push(payload);
      for (const waiter of waiters.filter(({ matches }) => matches(payload)))
        waiter.resolve();
    },
    notified: (matches: (payload: string) => boolean) =>
      new Promise<void>((resolve) => {
        if (received.some(matches)) resolve();
        else waiters.push({ matches, resolve });
      }),
  };
};

test('a committed transaction delivers its outbox row with a txid, a NOTIFY and an object payload; a rolled-back one delivers nothing', async () => {
  const client = new SQL(url);
  const testOnly = createTestOnlyOperations({ client });
  const listener = new SQL(url);
  const reader = new SQL(url);
  const readerDb = drizzle({ client: reader });
  const debateId = createId();
  const topic = `debate:${debateId}`;
  const payload = {
    version: 1,
    kind: 'debate.phase-changed' as const,
    ids: [debateId],
  };
  const notifications = notificationLog();
  try {
    const subscription = await listener.listen('outbox', notifications.record);
    try {
      const committed = await testOnly.transaction((tx) =>
        appendOutboxEvent(tx, {
          topic,
          kind: 'debate.phase-changed',
          version: 1,
          payload,
        }),
      );

      let rolledBack = false;
      try {
        await testOnly.transaction(async (tx) => {
          await appendOutboxEvent(tx, {
            topic,
            kind: 'debate.phase-changed',
            version: 1,
            payload: {
              version: 1,
              kind: 'debate.phase-changed',
              ids: [debateId],
            },
          });
          throw new Error('deliberate rollback');
        });
      } catch {
        rolledBack = true;
      }

      await notifications.notified((received) => {
        try {
          return decodeOutboxCursor(received).seq === committed.seq;
        } catch {
          return false;
        }
      });

      const rows = await drainOutbox(readerDb, OUTBOX_ORIGIN, 500);
      const delivered = rows.filter((row) => row.topic === topic);

      assert({
        given:
          'a committed transaction with an object payload and a rolled-back one',
        should:
          'notify, deliver exactly the committed row with a real txid and the payload round-tripped as an object (not a double-encoded string)',
        actual: {
          rolledBack,
          hasTxid: committed.txid !== '0',
          deliveredCount: delivered.length,
          kind: delivered[0]?.kind,
          seqMatches: delivered[0]?.seq === committed.seq,
          payload: delivered[0]?.payload,
          payloadIsObject: typeof delivered[0]?.payload === 'object',
        },
        expected: {
          rolledBack: true,
          hasTxid: true,
          deliveredCount: 1,
          kind: 'debate.phase-changed',
          seqMatches: true,
          payload,
          payloadIsObject: true,
        },
      });
    } finally {
      await subscription.unlisten();
    }
  } finally {
    await reader.unsafe('delete from outbox where topic = $1', [topic]);
    await listener.close();
    await reader.close();
    await client.close();
  }
});

test('two transactions that commit out of seq order never let the drain skip a row', async () => {
  const connA = new SQL(url, { max: 1 });
  const connB = new SQL(url, { max: 1 });
  const connC = new SQL(url, { max: 1 });
  const drizzleC = drizzle({ client: connC });
  const topic = `debate:${createId()}`;
  try {
    await connA.unsafe('BEGIN');
    const [rowA] = await connA.unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.a', 1, '{}'::jsonb) returning seq, txid",
      [topic],
    );

    await connB.unsafe('BEGIN');
    const [rowB] = await connB.unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.b', 1, '{}'::jsonb) returning seq, txid",
      [topic],
    );
    await connB.unsafe('COMMIT');

    // A is still open, so its txid still holds back the snapshot xmin: the
    // drain must show neither row yet, not even B's, which already committed.
    const midDrain = await drainOutbox(drizzleC, OUTBOX_ORIGIN, 500);
    const midForTopic = midDrain.filter((row) => row.topic === topic);

    await connA.unsafe('COMMIT');

    const finalDrain = await drainOutbox(drizzleC, OUTBOX_ORIGIN, 500);
    const forTopic = finalDrain.filter((row) => row.topic === topic);

    assert({
      given:
        'A opens and inserts, B opens, inserts and commits while A is still open, then A commits',
      should:
        'show neither row while A is open (even B, already committed), then both, A-lower-seq first, in (txid,seq) order',
      actual: {
        midCount: midForTopic.length,
        // Ordered by (txid, seq): A's lower seq stays first even though B
        // committed earlier in wall-clock time. Neither row is skipped.
        finalSeqs: forTopic.map((row) => row.seq),
      },
      expected: {
        midCount: 0,
        finalSeqs: [BigInt(rowA.seq), BigInt(rowB.seq)],
      },
    });
  } finally {
    await connC.unsafe('delete from outbox where topic = $1', [topic]);
    await connA.close();
    await connB.close();
    await connC.close();
  }
});

test('the storage-side family rule (RT-2.1c, plan revision 4.11) is enforced at appendOutboxEvent, with zero rows written for every refusal', async () => {
  const client = new SQL(url);
  const testOnly = createTestOnlyOperations({ client });
  const reader = new SQL(url);
  const actorId = createId();
  const inboxTopic = buildUserInboxTopic(actorId);
  const debateTopic = `debate:${createId()}`;

  const countFor = async (topic: string): Promise<number> => {
    const [row] = await reader.unsafe(
      'select count(*)::int as c from outbox where topic = $1',
      [topic],
    );
    return (row as { c: number }).c;
  };

  const attempt = (input: {
    topic: string;
    kind: string;
    version: number;
    payload: unknown;
  }) =>
    testOnly
      .transaction((tx) => appendOutboxEvent(tx, input as never))
      .then(() => 'accepted')
      .catch(() => 'refused');

  try {
    const accepted = await attempt({
      topic: inboxTopic,
      kind: 'session.revoked',
      version: 1,
      payload: { version: 1, kind: 'session.revoked', ids: [actorId] },
    });

    const wrongFamily = await attempt({
      topic: debateTopic,
      kind: 'session.revoked',
      version: 1,
      payload: { version: 1, kind: 'session.revoked', ids: [actorId] },
    });
    const unknownKind = await attempt({
      topic: inboxTopic,
      kind: 'nonsense.kind',
      version: 1,
      payload: { version: 1, kind: 'nonsense.kind', ids: [actorId] },
    });
    const extraField = await attempt({
      topic: inboxTopic,
      kind: 'session.revoked',
      version: 1,
      payload: {
        version: 1,
        kind: 'session.revoked',
        ids: [actorId],
        extra: 'nope',
      },
    });
    const unparseableTopic = await attempt({
      topic: 'not-a-real-topic',
      kind: 'session.revoked',
      version: 1,
      payload: { version: 1, kind: 'session.revoked', ids: [actorId] },
    });

    assert({
      given:
        'a session.revoked payload on the actor inbox, and the same payload on a debate topic, an unknown kind, an extra field, and an unparseable topic',
      should:
        'accept only the inbox control row and refuse every other pair with no outbox row written',
      actual: {
        accepted,
        wrongFamily,
        unknownKind,
        extraField,
        unparseableTopic,
        inboxRowCount: await countFor(inboxTopic),
        debateRowCount: await countFor(debateTopic),
      },
      expected: {
        accepted: 'accepted',
        wrongFamily: 'refused',
        unknownKind: 'refused',
        extraField: 'refused',
        unparseableTopic: 'refused',
        inboxRowCount: 1,
        debateRowCount: 0,
      },
    });
  } finally {
    await reader.unsafe('delete from outbox where topic = $1', [inboxTopic]);
    await reader.unsafe('delete from outbox where topic = $1', [debateTopic]);
    await reader.close();
    await client.close();
  }
});

test('refuses an append whose kind column disagrees with its payload kind, with no row written', async () => {
  const client = new SQL(url);
  const testOnly = createTestOnlyOperations({ client });
  const reader = new SQL(url);
  const actorId = createId();
  const topic = buildUserInboxTopic(actorId);
  try {
    const result = await testOnly
      .transaction((tx) =>
        appendOutboxEvent(tx, {
          topic,
          kind: 'bogus.kind',
          version: 1,
          payload: { version: 1, kind: 'session.revoked', ids: [actorId] },
        }),
      )
      .then(() => 'accepted')
      .catch(() => 'refused');
    const [row] = await reader.unsafe(
      'select count(*)::int as c from outbox where topic = $1',
      [topic],
    );

    assert({
      given:
        'an append with kind column "bogus.kind" and payload.kind "session.revoked"',
      should:
        'refuse it with no row written, since consumers and cleanups filter on the kind column',
      actual: { result, rows: (row as { c: number }).c },
      expected: { result: 'refused', rows: 0 },
    });
  } finally {
    await reader.unsafe('delete from outbox where topic = $1', [topic]);
    await reader.close();
    await client.close();
  }
});

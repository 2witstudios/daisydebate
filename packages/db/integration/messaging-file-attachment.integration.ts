import { instantMs, addMs } from '@daisy/clock';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { channelFileFrame } from '../src/messaging-files';
import { scopeFileFrame } from '../src/messaging/file-store';
import { createMessagingTestFixture } from '../src/testing';
import {
  fileDatabaseProofPolicy as policy,
  withFileProofFrame,
  withFileProofTransaction,
} from './messaging-files.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('native attachment and listing preserve the message and generation boundaries', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, otherUserId, channelId, now } = fixture;
  const messages = {
    own: createId(),
    peer: createId(),
    removed: createId(),
    second: createId(),
  };
  const statements: { query: string; params: unknown[] }[] = [];
  const db = drizzle({
    client,
    logger: {
      logQuery: (query, params) =>
        statements.push({ query: query.trim(), params }),
    },
  });
  const late = new Date(
    instantMs(now) + policy.reservationMs + 1,
  ).toISOString();
  const command = () => ({
    id: createId(),
    objectKey: createId(),
    requestId: createId(),
    filename: 'proof.pdf',
    mime: 'application/pdf' as const,
    bytes: 25,
  });
  const write: <T>(
    use: (frame: ReturnType<typeof channelFileFrame>) => Promise<T>,
  ) => Promise<T> = (use) => withFileProofFrame(db, fixture, use);
  const read = <T>(
    use: (frame: ReturnType<typeof channelFileFrame>) => Promise<T>,
    afterDiscovery?: (
      tx: Parameters<typeof channelFileFrame>[0],
    ) => Promise<void>,
  ) =>
    withFileProofTransaction(db, fixture, (tx, counters) => {
      let checks = 0;
      statements.length = 0;
      return use(
        channelFileFrame(
          tx,
          { channelId, actorId: otherActorId, userId: otherUserId },
          counters,
          async () => {
            if (++checks === 2) await afterDiscovery?.(tx);
          },
        ),
      );
    });
  try {
    await client`update messaging_channel_streams set message_sequence=4,change_version=4 where channel_id=${channelId}`;
    for (const [id, author, sequence, removed] of [
      [messages.own, actorId, 1, false],
      [messages.peer, otherActorId, 2, false],
      [messages.removed, actorId, 3, true],
      [messages.second, actorId, 4, false],
    ] as const)
      await client`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at) values(${id},${channelId},${author},${sequence},${sequence},${removed ? null : 'Proof message'},${now},${removed ? now : null})`;
    const first = await write((f) => f.reserve(command(), now, policy));
    const original = { fileId: first.id, generation: first.generation };
    await write((f) => f.quarantine(original, 20, now));
    for (const id of [messages.peer, messages.removed, createId()])
      await assertRejects({
        given: 'a foreign, removed or absent message',
        should: 'withhold attachment without releasing the quarantine',
        actual: () => write((f) => f.finalize(original, id, now, policy)),
        code: 'NOT_FOUND',
      });
    await write((f) => f.finalize(original, messages.own, now, policy));
    await write((f) => f.finalize(original, messages.own, late, policy));
    const pending = await write((f) => f.reserve(command(), now, policy));
    const second = { fileId: pending.id, generation: pending.generation };
    await write((f) => f.quarantine(second, 20, now));
    await assertRejects({
      given: 'the message already at the attachment cap',
      should: 'reject without replacing it or advancing',
      actual: () => write((f) => f.finalize(second, messages.own, now, policy)),
      code: 'PAYLOAD_TOO_LARGE',
    });
    const [stream] =
      await client`select change_version::int as version,(select count(*)::int from outbox where topic=${`channel:${channelId}`}) as bells from messaging_channel_streams where channel_id=${channelId}`;
    const access = await read((f) => f.access(original, late, policy));
    const list = (f: ReturnType<typeof channelFileFrame>) =>
      f.listMessageFiles([messages.own, messages.own], late, policy);
    const listed = await read(list);
    const discovery = statements[0];
    assert({
      given: 'one finalized attachment, replay and a quota-refused second file',
      should:
        'advance the stream once, avoid a channel bell, allow peer access after expiry and project public metadata only',
      actual: [
        stream,
        access.accessExpiresAt,
        listed,
        discovery?.params,
        discovery?.query.includes('inner join'),
        discovery?.query.includes('"removed_at" is null'),
      ],
      expected: [
        { version: 5, bells: 0 },
        addMs(late, policy.accessMs),
        [
          {
            ...original,
            messageId: messages.own,
            filename: 'proof.pdf',
            mime: 'application/pdf',
            bytes: 20,
          },
        ],
        [channelId, 'attached', messages.own],
        true,
        true,
      ],
    });
    const noGrant = async () => {
      throw createAppError('AUTHORIZATION');
    };
    const changed = async (tx: Parameters<typeof channelFileFrame>[0]) => {
      await tx.execute(
        sql`update messaging_files set message_id=${messages.second} where id=${first.id}`,
      );
    };
    const stale = async (tx: Parameters<typeof channelFileFrame>[0]) => {
      await tx.execute(
        sql`update messaging_files set generation=generation+1 where id=${first.id}`,
      );
    };
    const removed = async (tx: Parameters<typeof channelFileFrame>[0]) => {
      await tx.execute(
        sql`update messaging_messages set text=null,removed_at=${now}::timestamptz where id=${messages.own}`,
      );
    };
    for (const [interleave, code] of [
      [noGrant, 'AUTHORIZATION'],
      [changed, 'CONFLICT'],
      [stale, 'CONFLICT'],
      [removed, 'NOT_FOUND'],
    ] as const)
      await assertRejects({
        given:
          'an authority change, association move, supersession or removal after listing discovery',
        should: 'refuse stale attachment metadata',
        actual: () => read(list, interleave),
        code,
      });
    for (const [use, code] of [
      [
        (f: ReturnType<typeof channelFileFrame>) =>
          scopeFileFrame(f, 'post').access(original, late, policy),
        'AUTHORIZATION',
      ],
      [
        (f: ReturnType<typeof channelFileFrame>) =>
          scopeFileFrame(f, 'post').listMessageFiles(
            [messages.own],
            late,
            policy,
          ),
        'AUTHORIZATION',
      ],
      [
        (f: ReturnType<typeof channelFileFrame>) =>
          f.listMessageFiles([], late, { ...policy, maxStoredBytes: 10 }),
        'INFRASTRUCTURE',
      ],
      [
        (f: ReturnType<typeof channelFileFrame>) =>
          f.listMessageFiles([messages.own, 'bad'], late, policy),
        'VALIDATION',
      ],
      [
        (f: ReturnType<typeof channelFileFrame>) =>
          f.listMessageFiles([messages.own], 'bad', policy),
        'VALIDATION',
      ],
    ] as const) {
      await assertRejects({
        given: 'a post-only capability or malformed listing scope',
        should: 'refuse before attachment discovery',
        actual: () => read<unknown>(use),
        code,
      });
      assert({
        given: 'the refused file read',
        should: 'send no protected query',
        actual: statements,
        expected: [],
      });
    }
    assert({
      given: 'an empty view with valid policy and authority',
      should: 'skip file discovery',
      actual: await read((f) => f.listMessageFiles([], late, policy)),
      expected: [],
    });
    assert({
      given: 'the empty authorized read',
      should: 'send no SQL',
      actual: statements,
      expected: [],
    });
    await write((f) => f.cancel(original));
    const [file] =
      await client`select lifecycle,filename,mime,request_id,message_id,generation::int as generation,reserved_bytes::int as charged from messaging_files where id=${first.id}`;
    assert({
      given: 'the durable attachment cancellation',
      should:
        'remove public listing and scrub metadata without reducing charged bytes',
      actual: [await read(list), file],
      expected: [
        [],
        {
          lifecycle: 'deleting',
          filename: null,
          mime: null,
          request_id: null,
          message_id: null,
          generation: 2,
          charged: 25,
        },
      ],
    });
  } finally {
    await client`delete from messaging_files where channel_id=${channelId}`;
    await fixture.cleanup();
    await client.close();
  }
});

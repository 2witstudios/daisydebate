import { instantMs } from '@daisy/clock';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import {
  acknowledgeFileDeletion,
  type FileFrame,
} from '../src/messaging-files';
import {
  fileDatabaseProofPolicy as policy,
  withFileProofFrame,
} from './messaging-files.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const withAdmission = async (
  work: (input: {
    client: SQL;
    database: ReturnType<typeof drizzle>;
    fixture: Awaited<ReturnType<typeof createMessagingTestFixture>>;
    frame: <T>(
      work: (frame: FileFrame) => Promise<T>,
      denied?: boolean,
    ) => Promise<T>;
    statements: string[];
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  try {
    await work({
      client,
      database,
      fixture,
      statements,
      frame: (use, denied) =>
        withFileProofFrame(
          database,
          fixture,
          (current) => {
            statements.length = 0;
            return use(current);
          },
          denied,
        ),
    });
  } finally {
    await client`delete from messaging_files where channel_id=${fixture.channelId}`;
    await fixture.cleanup();
    await client.close();
  }
};
const command = () => ({
  id: createId(),
  objectKey: createId(),
  requestId: createId(),
  bytes: 25,
  filename: 'small.pdf',
  mime: 'application/pdf' as const,
});

test('native file reservation replays are immutable, and acknowledged deletion does not refill the day', () =>
  withAdmission(async ({ client, database, fixture, frame, statements }) => {
    const { actorId, channelId, now } = fixture;
    const allowed = { ...policy, maxUploadsPerDay: 2 };
    const first = command();
    for (const [input, at] of [
      [{ ...first, id: 'bad' }, now],
      [{ ...first, objectKey: 'bad' }, now],
      [{ ...first, requestId: 'bad' }, now],
      [{ ...first, filename: '   ' }, now],
      [{ ...first, bytes: 101 }, now],
      [first, 'not-a-time'],
    ] as const) {
      await assertRejects({
        given: 'an invalid reservation command',
        should: 'refuse before protected or quota SQL',
        actual: () => frame((f) => f.reserve(input, at, allowed)),
        code: 'VALIDATION',
      });
      assert({
        given: 'a prevalidate refusal inside the real fence',
        should: 'touch no protected persistence',
        actual: statements,
        expected: [],
      });
    }
    const admitted = await frame((f) => f.reserve(first, now, allowed));
    const replay = await frame((f) =>
      f.reserve(
        { ...first, id: createId(), objectKey: createId() },
        now,
        allowed,
      ),
    );
    const [written] =
      await client`select owner_actor_id,channel_id,object_key,reserved_bytes::int as charged,authority_revision::int as revision from messaging_files where id=${first.id}`;
    assert({
      given: 'an admitted reservation retried with newly allocated inner IDs',
      should:
        'retain original identity and bind the actual authority, account and charge',
      actual: [
        replay,
        written,
        statements.some((query) => query.startsWith('insert')),
      ],
      expected: [
        admitted,
        {
          owner_actor_id: actorId,
          channel_id: channelId,
          object_key: first.objectKey,
          charged: 25,
          revision: 1,
        },
        false,
      ],
    });
    const token = { fileId: admitted.id, generation: admitted.generation };
    await assertRejects({
      given: 'same request with different content',
      should: 'refuse conflicting replay',
      actual: () =>
        frame((f) => f.reserve({ ...first, bytes: 26 }, now, allowed)),
      code: 'CONFLICT',
    });
    const elapsed = new Date(
      instantMs(now) + policy.reservationMs + 1,
    ).toISOString();
    await assertRejects({
      given: 'same request after the owned deadline',
      should: 'refuse resurrection',
      actual: () => frame((f) => f.reserve(first, elapsed, allowed)),
      code: 'CONFLICT',
    });
    await frame((f) => f.reserve(command(), now, allowed));
    await assertRejects({
      given:
        'two charged reservations filling the count but not the byte quota',
      should: 'refuse on count',
      actual: () => frame((f) => f.reserve(command(), now, allowed)),
      code: 'PAYLOAD_TOO_LARGE',
    });
    await frame((f) => f.cancel(token));
    await assertRejects({
      given: 'a pending deletion',
      should: 'refuse its old upload',
      actual: () => frame((f) => f.upload(token, now)),
      code: 'NOT_FOUND',
    });
    await acknowledgeFileDeletion(database, admitted.id, now, async () => {});
    await assertRejects({
      given: 'an acknowledged deletion',
      should: 'free storage count but not the reserved day budget',
      actual: () => frame((f) => f.reserve(command(), now, allowed)),
      code: 'RATE_LIMIT',
    });
    await assertRejects({
      given: 'a deleted persisted object',
      should: 'refuse its old upload',
      actual: () => frame((f) => f.upload(token, now)),
      code: 'NOT_FOUND',
    });
  }));

test('native pending file operations refuse stale authority and advance only valid generations', () =>
  withAdmission(async ({ client, fixture, frame, statements }) => {
    const { channelId, actorId, otherActorId, now } = fixture;
    const request = command();
    const messageId = createId();
    const late = new Date(
      instantMs(now) + policy.reservationMs + 1,
    ).toISOString();
    const admitted = await frame((f) => f.reserve(request, now, policy));
    const token = { fileId: admitted.id, generation: 1 };
    const runDenied = <T>(operation: (f: FileFrame) => Promise<T>) =>
      assertRejects({
        given: 'each revoked file operation',
        should: 'refuse before a protected query',
        actual: () => frame(operation, true),
        code: 'AUTHORIZATION',
      });
    for (const operation of [
      (f: FileFrame) => f.authorize(),
      (f: FileFrame) => f.reserve(request, now, policy),
      (f: FileFrame) => f.upload(token, now),
      (f: FileFrame) => f.scan(token, now),
      (f: FileFrame) => f.quarantine(token, 20, now),
      (f: FileFrame) => f.renew(token, now, policy),
      (f: FileFrame) => f.finalize(token, messageId, now, policy),
      (f: FileFrame) => f.access(token, now, policy),
      (f: FileFrame) => f.cancel(token),
    ]) {
      await runDenied<unknown>(operation);
      assert({
        given: 'the refused protected operation',
        should: 'issue no protected SQL',
        actual: statements,
        expected: [],
      });
    }
    for (const invalid of [
      { ...token, fileId: 'bad' },
      { ...token, generation: 0 },
      { ...token, generation: Number.NaN },
    ]) {
      await assertRejects({
        given: 'an invalid file token',
        should: 'refuse before lookup',
        actual: () => frame((f) => f.upload(invalid, now)),
        code: 'VALIDATION',
      });
      assert({
        given: 'the malformed token',
        should: 'query nothing after the fence',
        actual: statements,
        expected: [],
      });
    }
    for (const [attempt, code] of [
      [
        () => frame((f) => f.upload({ ...token, fileId: createId() }, now)),
        'NOT_FOUND',
      ],
      [() => frame((f) => f.upload(token, late)), 'CONFLICT'],
      [() => frame((f) => f.scan(token, now)), 'CONFLICT'],
      [() => frame((f) => f.access(token, now, policy)), 'NOT_FOUND'],
    ] as const)
      await assertRejects({
        given: 'a missing, expired or wrong pending lifecycle',
        should: 'refuse without mutating',
        actual: attempt,
        code,
      });
    for (const bytes of [0, 26, 1.5])
      await assertRejects({
        given: 'invalid or oversized stored bytes',
        should: 'refuse quarantine',
        actual: () => frame((f) => f.quarantine(token, bytes, now)),
        code: 'CONFLICT',
      });
    await client`update messaging_files set owner_actor_id=${otherActorId} where id=${token.fileId}`;
    await assertRejects({
      given: 'the same object owned by the peer',
      should: 'withhold pending metadata',
      actual: () => frame((f) => f.upload(token, now)),
      code: 'NOT_FOUND',
    });
    await client`update messaging_files set owner_actor_id=${actorId} where id=${token.fileId}`;
    await client`update messaging_channels set authority_revision=2 where id=${channelId}`;
    await assertRejects({
      given: 'the pending object after authority revision changes',
      should: 'refuse its earlier upload',
      actual: () => frame((f) => f.upload(token, now)),
      code: 'CONFLICT',
    });
    await client`update messaging_channels set authority_revision=1 where id=${channelId}`;
    const uploading = await frame((f) => f.upload(token, now));
    await client`update messaging_channel_streams set message_sequence=1,change_version=1 where channel_id=${channelId}`;
    await client`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${messageId},${channelId},${actorId},1,1,'Attaching proof',${now})`;
    await assertRejects({
      given: 'a reserved but unscanned file',
      should: 'refuse finalization',
      actual: () => frame((f) => f.finalize(token, messageId, now, policy)),
      code: 'CONFLICT',
    });
    await frame((f) => f.quarantine(token, 20, now));
    const scanning = await frame((f) => f.scan(token, now));
    await assertRejects({
      given: 'an invalid message ID on a quarantined file',
      should: 'reject attachment',
      actual: () => frame((f) => f.finalize(token, 'bad', now, policy)),
      code: 'VALIDATION',
    });
    const renewed = await frame((f) => f.renew(token, now, policy));
    const current = { fileId: renewed.id, generation: renewed.generation };
    await assertRejects({
      given: 'the earlier scanner token',
      should: 'refuse the old generation',
      actual: () => frame((f) => f.upload(token, now)),
      code: 'CONFLICT',
    });
    await frame((f) => f.finalize(current, messageId, now, policy));
    for (const attempt of [
      () => frame((f) => f.renew(current, now, policy)),
      () => frame((f) => f.quarantine(current, 20, now)),
    ])
      await assertRejects({
        given: 'an attached file',
        should: 'refuse pending-only transitions',
        actual: attempt,
        code: 'CONFLICT',
      });
    await assertRejects({
      given: 'an invalid read clock on attached content',
      should: 'conceal access',
      actual: () => frame((f) => f.access(current, 'not-a-time', policy)),
      code: 'NOT_FOUND',
    });
    const [upload, scan, replay] = await frame(async (f) => [
      await f.upload(current, late),
      await f.scan(current, late),
      await f.reserve(request, late, policy),
    ]);
    assert({
      given: 'a native reserve, quarantine, renewal and attachment',
      should:
        'return only admitted states, preserve charged bytes, and make attached replay independent of reservation expiry',
      actual: [
        uploading.lifecycle,
        scanning.lifecycle,
        renewed.generation,
        renewed.reservedBytes,
        upload?.lifecycle,
        scan?.lifecycle,
        replay?.lifecycle,
        statements.some((query) => /^(insert|update|delete)/.test(query)),
      ],
      expected: [
        'reserved',
        'quarantined',
        2,
        25,
        'attached',
        'attached',
        'attached',
        false,
      ],
    });
  }));

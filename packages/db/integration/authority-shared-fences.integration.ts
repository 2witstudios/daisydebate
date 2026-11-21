import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createMessagingStore } from '../src/messaging';
import {
  castChanged,
  createMessagingChannelAuthority,
  restartingRead,
  withLockedMessagingAuthority,
} from '../src/messaging/authority-frame';
import { createMessagingTestFixture } from '../src/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sqlStateOf, withFixture } from './constraint-helpers';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();

/**
 * Holds `fence` open in one transaction while `attempt` runs in another
 * with a short lock_timeout: 'accepted' means it never waited on the held
 * fence, 55P03 means it had to.
 */
async function whileHeld(
  fence: (sql: SQL) => Promise<unknown>,
  attempt: (sql: SQL) => Promise<unknown>,
) {
  const holder = new SQL(url);
  const other = new SQL(url);
  try {
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holding = holder.begin(async (tx) => {
      await fence(tx);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const outcome = await sqlStateOf(() =>
      other.begin(async (tx) => {
        await tx`set local lock_timeout = '300ms'`;
        await attempt(tx);
      }),
    );
    release.resolve();
    await holding;
    return outcome;
  } finally {
    await holder.close();
    await other.close();
  }
}

const readAccounts = (actorId: string) => (sql: SQL) =>
  sql`select * from public.daisy_authorization_read_accounts_v2(array[${actorId}]::text[])`;
const lockAccounts = (actorId: string) => (sql: SQL) =>
  sql`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[], null::text, true)`;

test('the minimal DM authority frame binds the consumer after ordered real fences', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const extra = await createMessagingTestFixture(client);
  const statements: string[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const { actorId, userId, channelId } = fixture;
  const scope = { actorId, userId, channelId };
  const read = createMessagingChannelAuthority(db);
  const word = (text: string) =>
    text === 'extension'
      ? 'extension'
      : text.includes('jsonb_build_object')
        ? 'fact'
        : /daisy_authorization_(read_)?accounts/.test(text)
          ? 'accounts'
          : text.includes('daisy_messaging_channel_')
            ? 'channel'
            : null;
  const steps = () => statements.splice(0).map(word).filter(Boolean);
  try {
    const minimal = await read(scope, async (frame) => ({
      exact: frame.fact.channelId === channelId,
      fields: Object.keys(frame).sort(),
      content: statements.some((text) =>
        /messaging_messages|\btitle\b/i.test(text),
      ),
    }));
    const readSteps = steps();
    const extended = await db.transaction((tx) =>
      withLockedMessagingAuthority(
        tx,
        scope,
        async (frame) => frame.tx === tx,
        {
          additionalActors: [extra.actorId],
          beforeChannel: async (frame) => {
            if (
              frame.tx !== tx ||
              !frame.accounts.some((row) => row?.actorId === extra.actorId)
            )
              throw new Error(
                'The extension did not receive the current account fences',
              );
            statements.push('extension');
          },
        },
      ),
    );
    assert({
      given:
        'the shareable DM read and an extended write over the same durable cast',
      should:
        'read only authority and run the extension after account locks and before the channel',
      actual: [minimal, readSteps, extended, steps()],
      expected: [
        { exact: true, fields: ['accounts', 'fact', 'tx'], content: false },
        ['fact', 'accounts', 'channel', 'fact'],
        true,
        ['fact', 'accounts', 'extension', 'channel', 'fact'],
      ],
    });
    await assertRejects({
      given: 'a well-formed but missing channel',
      should: 'refuse before calling the consumer',
      actual: () =>
        read({ ...scope, channelId: createId() }, async () => {
          throw new Error('Missing channel reached the consumer');
        }),
      code: 'NOT_FOUND',
    });
  } finally {
    await extra.cleanup();
    await fixture.cleanup();
    await client.close();
  }
});

test('the read retry opens fresh PostgreSQL transactions only for cast change', async () => {
  const client = new SQL(url, { max: 1 });
  const db = drizzle({ client });
  try {
    const attempts = async (failure: (attempt: number) => Error | null) => {
      let reads = 0;
      const answer = await restartingRead(db, async () => {
        const refusal = failure(++reads);
        if (refusal) throw refusal;
        return 'fresh';
      }).catch((error: { code?: string }) => error.code);
      return { answer, reads };
    };
    assert({
      given:
        'a wrapped cast change, an unrelated conflict and a persistently moving cast',
      should:
        'retry a cast change at most twice and report the unrelated failure at once',
      actual: [
        await attempts((n) =>
          n === 1
            ? new Error('driver wrapper', { cause: castChanged() })
            : null,
        ),
        await attempts(() => createAppError('CONFLICT')),
        await attempts(castChanged),
      ],
      expected: [
        { answer: 'fresh', reads: 2 },
        { answer: 'CONFLICT', reads: 1 },
        { answer: 'INFRASTRUCTURE', reads: 3 },
      ],
    });
  } finally {
    await client.close();
  }
});

describe('read-compatible authority fences (MSG-2.1-arch1)', () => {
  test('two readers of one account pass the fence together; a writer waits for them', async () => {
    await withFixture(url, async (fixture) => {
      const actorId = await fixture.actor();
      assert({
        given: 'one transaction holding the shared account fence',
        should:
          'let a second reader through at once and make an exclusive writer wait',
        actual: {
          reader: await whileHeld(readAccounts(actorId), readAccounts(actorId)),
          writer: await whileHeld(readAccounts(actorId), lockAccounts(actorId)),
          readerBehindWriter: await whileHeld(
            lockAccounts(actorId),
            readAccounts(actorId),
          ),
        },
        expected: {
          reader: 'accepted',
          writer: '55P03',
          readerBehindWriter: '55P03',
        },
      });
    });
  });

  test('the age reader takes the shared fence, so it never serializes readers', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const [{ version }] =
        await fixture.sql`select version from users where id=${userId}`;
      const age = (sql: SQL) =>
        sql`select * from public.daisy_authorization_age(${userId}, ${actorId}, ${version}::integer, now())`;
      assert({
        given: 'one age read holding its account fence',
        should: 'let another age read and a plain reader through at once',
        actual: [
          await whileHeld(age, age),
          await whileHeld(age, readAccounts(actorId)),
        ],
        expected: ['accepted', 'accepted'],
      });
    });
  });

  test('two readers of one DM channel pass the pair and channel fences together; writers and readers wait for each other', async () => {
    const client = new SQL(url);
    const f = await createMessagingTestFixture(client);
    try {
      const readChannel = (sql: SQL) =>
        sql`select public.daisy_messaging_channel_read_fence(${f.channelId}, ${f.low}, ${f.high}) as fenced`;
      const lockChannel = (sql: SQL) =>
        sql`select public.daisy_messaging_channel_fence(${f.channelId}, ${f.low}, ${f.high}) as fenced`;
      const [{ fenced }] = await readChannel(client);
      assert({
        given:
          'a DM channel whose pair and channel row one reader holds shared',
        should:
          'admit a second reader at once, make the exclusive writer wait, and make a reader wait behind a held writer',
        actual: {
          fenced,
          reader: await whileHeld(readChannel, readChannel),
          writer: await whileHeld(readChannel, lockChannel),
          readerBehindWriter: await whileHeld(lockChannel, readChannel),
          // A swapped pair is not a selector the fence accepts.
          swappedPair: await sqlStateOf(
            () =>
              client`select public.daisy_messaging_channel_read_fence(${f.channelId}, ${f.high}, ${f.low})`,
          ),
        },
        expected: {
          fenced: true,
          reader: 'accepted',
          writer: '55P03',
          readerBehindWriter: '55P03',
          swappedPair: '22023',
        },
      });
    } finally {
      await f.cleanup();
      await client.close();
    }
  });

  test('private group readers share the channel row; a writer waits for them', async () => {
    const client = new SQL(url);
    const channelId = createId();
    try {
      await client.unsafe(
        "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values($1,'private_group','social.private_group',1,'active')",
        [channelId],
      );
      await client.unsafe(
        'insert into messaging_channel_streams(channel_id) values($1)',
        [channelId],
      );
      const readGroup = (sql: SQL) =>
        sql`select public.daisy_messaging_channel_read_fence(${channelId}, null, null) as fenced`;
      const lockGroup = (sql: SQL) =>
        sql`select public.daisy_messaging_channel_fence(${channelId}, null, null) as fenced`;
      const [{ fenced }] = await readGroup(client);
      assert({
        given: 'a private group channel held by one shared reader',
        should: 'admit a second reader and make the exclusive writer wait',
        actual: {
          fenced,
          reader: await whileHeld(readGroup, readGroup),
          writer: await whileHeld(readGroup, lockGroup),
        },
        expected: { fenced: true, reader: 'accepted', writer: '55P03' },
      });
    } finally {
      await client.unsafe('delete from messaging_channels where id=$1', [
        channelId,
      ]);
      await client.close();
    }
  });

  test('a store history read runs end to end under the shared fences', async () => {
    const client = new SQL(url);
    const f = await createMessagingTestFixture(client);
    const messageId = createId();
    try {
      await client.unsafe(
        'update messaging_channel_streams set message_sequence=1,change_version=1 where channel_id=$1',
        [f.channelId],
      );
      await client.unsafe(
        'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,1,1,$4,$5)',
        [messageId, f.channelId, f.actorId, 'Shared read', f.now],
      );
      const store = createMessagingStore({
        database: drizzle({ client }),
        authorize: async () => {},
      });
      const scope = {
        channelId: f.channelId,
        userId: f.userId,
        actorId: f.actorId,
      };
      const pages = await Promise.all(
        [0, 1].map(() =>
          store.readChannel(scope, (frame) => frame.history({ limit: 10 })),
        ),
      );
      assert({
        given: 'two concurrent history reads of one DM through readChannel',
        should: 'both answer the message from real Postgres',
        actual: pages.map((page) => page.messages.map((row) => row.id)),
        expected: [[messageId], [messageId]],
      });
    } finally {
      await f.cleanup();
      await client.close();
    }
  });

  test('a reader blocked behind a writer that revokes it never answers from the old cast', async () => {
    const client = new SQL(url);
    const holder = new SQL(url);
    const f = await createMessagingTestFixture(client);
    const groupId = createId();
    try {
      await client.unsafe(
        "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values($1,'private_group','social.private_group',1,'active')",
        [groupId],
      );
      await client.unsafe(
        'insert into messaging_channel_streams(channel_id) values($1)',
        [groupId],
      );
      await client.unsafe(
        "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$4),($1,$3,'member',1,$4)",
        [groupId, f.actorId, f.otherActorId, f.now],
      );
      // The member's read evaluates whatever cast it is handed after its waits.
      const casts: (readonly string[])[] = [];
      const store = createMessagingStore({
        database: drizzle({ client }),
        authorize: async (_tx, input, { fact }) => {
          const members =
            fact.authority.kind === 'private_group'
              ? fact.authority.activeMemberActorIds
              : [];
          casts.push(members);
          if (!members.includes(input.actorId))
            throw createAppError('AUTHORIZATION');
        },
      });
      const held = Promise.withResolvers<void>();
      const revoke = Promise.withResolvers<void>();
      const writer = holder.begin(async (tx) => {
        await tx`select public.daisy_messaging_channel_fence(${groupId}, null, null)`;
        held.resolve();
        await revoke.promise;
        await tx`update messaging_group_grants set revoked_at = now() where channel_id = ${groupId} and actor_id = ${f.otherActorId}`;
      });
      await held.promise;
      const reading = store
        .readChannel(
          {
            channelId: groupId,
            userId: f.otherUserId,
            actorId: f.otherActorId,
          },
          async (frame) => {
            await frame.authorize();
            return 'answered';
          },
        )
        .then(
          (answer) => answer,
          (error: { code?: unknown }) => `refused:${String(error.code)}`,
        );
      // Wait until the reader is queued on the writer's channel row lock:
      // waiters in this database, on a backend other than the poller.
      let waited = false;
      for (let tries = 0; tries < 100 && !waited; tries += 1) {
        const [{ waiting }] = await client`
          select count(*)::int as waiting from pg_locks l
          join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.datname = current_database()
            and l.pid <> pg_backend_pid()`;
        waited = waiting > 0;
        if (!waited) await Bun.sleep(20);
      }
      revoke.resolve();
      await writer;
      const outcome = await reading;
      assert({
        given:
          'a member reading a private group while a writer holds the channel and revokes that member before committing',
        should:
          'block behind the writer, then refuse the read, never handing authorization a cast that still includes the revoked member',
        actual: {
          waited,
          refused: outcome.startsWith('refused:'),
          staleCasts: casts.filter((members) =>
            members.includes(f.otherActorId),
          ).length,
        },
        expected: { waited: true, refused: true, staleCasts: 0 },
      });
    } finally {
      await client.unsafe('delete from messaging_channels where id=$1', [
        groupId,
      ]);
      await f.cleanup();
      await holder.close();
      await client.close();
    }
  });
});

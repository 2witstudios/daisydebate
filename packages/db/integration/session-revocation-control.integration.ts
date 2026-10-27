import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import {
  buildUserInboxTopic,
  isPayloadStorableOnTopic,
  outboxPayloadSchema,
} from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  rejected,
  withDatabase,
  withFixture,
  type Fixture,
} from './constraint-helpers';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();

const session = async (
  fixture: Fixture,
  userId: string,
  expiresAt = '2099-01-01T00:00:00.000Z',
) => {
  const id = createId();
  await fixture.insert('session', {
    id,
    token: createId(),
    user_id: userId,
    expires_at: expiresAt,
  });
  return id;
};

/** The `session.revoked` controls on an actor's inbox topic, as their ids. */
const controls = async (fixture: Fixture, actorId: string) =>
  (
    (await fixture.sql`select payload from outbox
      where topic=${buildUserInboxTopic(actorId)} and kind='session.revoked'
      order by seq`) as { payload: { ids: string[] } }[]
  ).map(({ payload }) => payload.ids);

/** One account with an actor and one live session, inside a fixture. */
const withSessionOwner = (
  run: (
    fixture: Fixture,
    owner: {
      readonly userId: string;
      readonly actorId: string;
      readonly id: string;
    },
  ) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    await run(fixture, { userId, actorId, id: await session(fixture, userId) });
  });

describe('session revocation control (MSG-2.1-arch1, ADR 0032 §5)', () => {
  test('revoke-all announces exactly each deleted session, in the deleting transaction', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const kept = await session(fixture, userId);
      const [first, second] = [
        await session(fixture, userId),
        await session(fixture, userId),
      ];
      const [{ token: keepToken }] =
        await fixture.sql`select token from session where id=${kept}`;
      const removed = await withDatabase(url, (database) =>
        database.revokeOtherSessions(userId, keepToken),
      );
      const ids = await controls(fixture, actorId);
      assert({
        given: 'three sessions and a revoke-all keeping one',
        should: 'delete two and append one control naming each of them',
        actual: { removed, ids: ids.map(([, id]) => id).sort() },
        expected: { removed: 2, ids: [first!, second!].sort() },
      });
      const rows = (await fixture.sql`select topic, kind, payload from outbox
        where topic=${buildUserInboxTopic(actorId)}`) as {
        topic: string;
        kind: string;
        payload: unknown;
      }[];
      assert({
        given: 'each control the trigger wrote',
        should:
          'name the actor first and parse as a storable session.revoked under the protocol schema',
        actual: rows.map(({ topic, kind, payload }) => {
          const parsed = outboxPayloadSchema.safeParse(payload);
          return {
            kind,
            parsed: parsed.success && parsed.data.kind === kind,
            storable: isPayloadStorableOnTopic(topic, payload),
            actorFirst:
              parsed.success && 'ids' in parsed.data
                ? parsed.data.ids[0] === actorId
                : false,
          };
        }),
        expected: rows.map(() => ({
          kind: 'session.revoked',
          parsed: true,
          storable: true,
          actorFirst: true,
        })),
      });
    });
  });

  test('a direct delete, as Better Auth signs out, announces that session', async () => {
    await withSessionOwner(async (fixture, { actorId, id }) => {
      await fixture.sql`delete from session where id=${id}`;
      assert({
        given:
          'a session deleted by a plain DELETE outside any Daisy operation',
        should: 'append its control',
        actual: await controls(fixture, actorId),
        expected: [[actorId, id]],
      });
    });
  });

  test('the expiry sweep removes expired sessions without announcing them', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const expired = await session(
        fixture,
        userId,
        '2000-01-01T00:00:00.000Z',
      );
      const live = await session(fixture, userId);
      await withDatabase(url, (database) =>
        database.purgeExpiredSessions({
          before: '2001-01-01T00:00:00.000Z',
          limit: 100,
        }),
      );
      await fixture.sql`delete from session where id=${live}`;
      assert({
        given:
          'the retention sweep removing an expired session, then a live session deleted',
        should:
          'append no control for the expired session (realtime already refuses it) and one for the live one',
        actual: {
          expiredGone: await fixture.count('session', 'id', expired),
          controls: await controls(fixture, actorId),
        },
        expected: { expiredGone: 0, controls: [[actorId, live]] },
      });
    });
  });

  test('an account without an actor deletes its sessions and appends nothing', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const id = await session(fixture, userId);
      await fixture.sql`delete from session where id=${id}`;
      const after = await fixture.sql`select count(*)::int as c from outbox
        where kind='session.revoked' and payload->'ids'->>1 = ${id}`;
      assert({
        given: 'a provisional account (no actor) whose session is deleted',
        should: 'delete it without a control',
        actual: {
          deleted: await fixture.count('session', 'id', id),
          controls: after[0].c,
        },
        expected: { deleted: 0, controls: 0 },
      });
    });
  });

  test('a rolled-back delete leaves no control', async () => {
    await withSessionOwner(async (fixture, { actorId, id }) => {
      await fixture.sql
        .begin(async (tx) => {
          await tx`delete from session where id=${id}`;
          throw new Error('roll back');
        })
        .catch(() => undefined);
      assert({
        given: 'a session delete whose transaction rolls back',
        should: 'keep the session and append nothing',
        actual: {
          kept: await fixture.count('session', 'id', id),
          controls: await controls(fixture, actorId),
        },
        expected: { kept: 1, controls: [] },
      });
    });
  });

  test('a failed control append rolls the delete back', async () => {
    await withSessionOwner(async (fixture, { actorId, id }) => {
      const topic = buildUserInboxTopic(actorId);
      const guard = `block_${createId()}`;
      await fixture.sql.unsafe(`create function ${guard}() returns trigger
        language plpgsql as $$ begin
          if new.topic = '${topic}' then raise exception 'blocked'; end if;
          return new; end $$`);
      await fixture.sql.unsafe(
        `create trigger ${guard} before insert on outbox for each row execute function ${guard}()`,
      );
      let refused: boolean;
      try {
        refused = await rejected(
          () => fixture.sql`delete from session where id=${id}`,
        );
      } finally {
        await fixture.sql.unsafe(`drop trigger ${guard} on outbox`);
        await fixture.sql.unsafe(`drop function ${guard}()`);
      }
      assert({
        given: 'a session delete whose control insert fails',
        should: 'refuse the delete and keep the session',
        actual: { refused, kept: await fixture.count('session', 'id', id) },
        expected: { refused: true, kept: 1 },
      });
    });
  });
});

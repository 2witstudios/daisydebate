import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture, type Fixture } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/** Every actor id a user holds. */
const actorIdsOf = async (fixture: Fixture, userId: string) =>
  (
    (await fixture.sql.unsafe('select id from actors where user_id = $1', [
      userId,
    ])) as Array<{ id: string }>
  ).map(({ id }) => id);

describe('claimUsername creates the human actor (ACTOR-1, ADR 0029)', () => {
  test('a claim inserts a human actor row using the injected id source', async () => {
    await withFixture(url, async (fixture) => {
      const userId = createId();
      const actorId = createId();
      fixture.track('actors', actorId);
      await fixture.insert('users', { id: userId, username: null });
      const database = createDatabase({ url, nextActorId: () => actorId });
      let outcome;
      try {
        outcome = await database.claimUsername({
          userId,
          username: `claimed-${userId}`,
        });
      } finally {
        await database.close();
      }
      const [row] = (await fixture.sql.unsafe(
        'select id, kind, user_id from actors where user_id = $1',
        [userId],
      )) as Array<{ id: string; kind: string; user_id: string }>;
      assert({
        given: 'a user with no username claiming one for the first time',
        should:
          'claim the name and insert exactly one human actor with the injected id',
        actual: [outcome?.kind, row],
        expected: ['claimed', { id: actorId, kind: 'human', user_id: userId }],
      });
    });
  });

  test('a retry by the same owner creates no second actor', async () => {
    await withFixture(url, async (fixture) => {
      const userId = createId();
      const firstActorId = createId();
      const secondActorId = createId();
      fixture.track('actors', firstActorId);
      fixture.track('actors', secondActorId);
      await fixture.insert('users', { id: userId, username: null });
      const username = `claimed-${userId}`;
      const first = createDatabase({ url, nextActorId: () => firstActorId });
      const second = createDatabase({ url, nextActorId: () => secondActorId });
      let outcomes: readonly [{ kind: string }, { kind: string }];
      try {
        outcomes = [
          await first.claimUsername({ userId, username }),
          await second.claimUsername({ userId, username }),
        ];
      } finally {
        await Promise.all([first.close(), second.close()]);
      }
      assert({
        given: 'the same owner retrying a claim that already succeeded',
        should:
          'answer unchanged the second time and leave exactly the first actor',
        actual: [
          outcomes.map((o) => o.kind),
          await actorIdsOf(fixture, userId),
        ],
        expected: [['claimed', 'unchanged'], [firstActorId]],
      });
    });
  });

  test('regression: a failed actor insert rolls the username claim back too', async () => {
    await withFixture(url, async (fixture) => {
      const userId = createId();
      const actorId = createId();
      const trigger = `actor1_reg_${createId().slice(0, 12)}`;
      // A real Postgres-level fault inside the same statement claimUsername
      // issues, not a stub of the function under test — the same technique
      // RT-2.2's atomicity suites use (renaming a table away). Proves the
      // transaction wrapper is load-bearing: with `database.transaction`
      // removed, the UPDATE commits before this trigger ever fires and the
      // assertion below goes red.
      await fixture.sql.unsafe(`
        create function "${trigger}"() returns trigger as $$
        begin
          if new.user_id = '${userId}' then
            raise exception 'ACTOR-1 regression probe: forced actor insert failure';
          end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger "${trigger}" before insert on actors
          for each row execute function "${trigger}"();
      `);
      await fixture.insert('users', { id: userId, username: null });
      const database = createDatabase({ url, nextActorId: () => actorId });
      let threw = false;
      try {
        await database.claimUsername({ userId, username: `claimed-${userId}` });
      } catch {
        threw = true;
      } finally {
        await database.close();
        await fixture.sql.unsafe(
          `drop trigger "${trigger}" on actors; drop function "${trigger}"();`,
        );
      }
      const [row] = (await fixture.sql.unsafe(
        'select username from users where id = $1',
        [userId],
      )) as Array<{ username: string | null }>;
      assert({
        given: 'a real fault raised while the transaction inserts the actor',
        should:
          'propagate the failure and leave the username claim uncommitted',
        actual: {
          threw,
          username: row?.username,
          actorCount: await fixture.count('actors', 'user_id', userId),
        },
        expected: { threw: true, username: null, actorCount: 0 },
      });
    });
  });

  test('a claim for a user who already has an actor with no username keeps that actor (onConflictDoNothing)', async () => {
    await withFixture(url, async (fixture) => {
      const userId = createId();
      await fixture.insert('users', { id: userId, username: null });
      // A stand-in actor with no username, the shape RT-2.2's own fixtures
      // use for a user who has not claimed one yet: the only realistic way
      // an actor and a NULL username coexist, since claimUsername is the
      // only writer of both together.
      const preexistingActorId = await fixture.actor(userId);
      const newActorId = createId();
      const database = createDatabase({ url, nextActorId: () => newActorId });
      let outcome;
      try {
        outcome = await database.claimUsername({
          userId,
          username: `claimed-${userId}`,
        });
      } finally {
        await database.close();
      }
      assert({
        given:
          'a user whose actor already exists from before they had a username',
        should:
          'claim the name and keep the pre-existing actor, inserting no second one',
        actual: [outcome?.kind, await actorIdsOf(fixture, userId)],
        expected: ['claimed', [preexistingActorId]],
      });
    });
  });

  test('negative control: a call that claims nothing inserts no actor', async () => {
    await withFixture(url, async (fixture) => {
      const userId = createId();
      const actorId = createId();
      await fixture.insert('users', {
        id: userId,
        username: `already-${userId}`,
      });
      const database = createDatabase({ url, nextActorId: () => actorId });
      let outcome;
      try {
        outcome = await database.claimUsername({
          userId,
          username: `different-${userId}`,
        });
      } finally {
        await database.close();
      }
      const count = await fixture.count('actors', 'user_id', userId);
      assert({
        given: 'a user whose username is already set to a different name',
        should: 'answer already-set and insert no actor for that user',
        actual: [outcome?.kind, count],
        expected: ['already-set', 0],
      });
    });
  });
});

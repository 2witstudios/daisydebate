import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

/**
 * The migration file has no other statement-breakpoints, so stripping its
 * `--`-prefixed commentary leaves exactly the one backfill INSERT it ships;
 * this proves the statement actually committed with this repository's
 * migrations, not a hand-copied approximation of it.
 */
const migrationPath = fileURLToPath(
  new URL('../migrations/0003_actor_backfill.sql', import.meta.url),
);
const backfillStatement = readFileSync(migrationPath, 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .trim();

describe('0003_actor_backfill.sql (ACTOR-1, ADR 0029)', () => {
  test('backfills one human actor per onboarded user, deterministic and idempotent twice', async () => {
    await withFixture(url, async (fixture) => {
      const onboardedId = createId();
      const pendingId = createId();
      await fixture.insert('users', {
        id: onboardedId,
        username: `onboarded-${onboardedId}`,
      });
      await fixture.insert('users', { id: pendingId, username: null });
      fixture.track('users', onboardedId);
      fixture.track('users', pendingId);

      await fixture.sql.unsafe(backfillStatement);
      const afterFirst = [
        await fixture.count('actors', 'user_id', onboardedId),
        await fixture.count('actors', 'user_id', pendingId),
      ];
      const [firstRow] = (await fixture.sql.unsafe(
        'select id from actors where user_id = $1',
        [onboardedId],
      )) as Array<{ id: string }>;
      if (!firstRow) throw new Error('Backfill inserted no actor');
      fixture.track('actors', firstRow.id);

      await fixture.sql.unsafe(backfillStatement);
      const afterSecond = [
        await fixture.count('actors', 'user_id', onboardedId),
        await fixture.count('actors', 'user_id', pendingId),
      ];
      const [secondRow] = (await fixture.sql.unsafe(
        'select id, kind from actors where user_id = $1',
        [onboardedId],
      )) as Array<{ id: string; kind: string }>;
      if (!secondRow) throw new Error('Actor vanished after replay');

      assert({
        given: 'an onboarded user with no actor and a pending user with none',
        should:
          'insert exactly one human actor for the onboarded user, none for the pending one, and stay a no-op on replay',
        actual: {
          afterFirst,
          afterSecond,
          sameActorBothRuns: secondRow.id === firstRow.id,
          kind: secondRow.kind,
        },
        expected: {
          afterFirst: [1, 0],
          afterSecond: [1, 0],
          sameActorBothRuns: true,
          kind: 'human',
        },
      });
    });
  });

  test('negative control: an already-backfilled user keeps their existing actor', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const existingActorId = await fixture.actor(userId);

      await fixture.sql.unsafe(backfillStatement);
      const count = await fixture.count('actors', 'user_id', userId);
      const [row] = (await fixture.sql.unsafe(
        'select id from actors where user_id = $1',
        [userId],
      )) as Array<{ id: string }>;

      assert({
        given: 'a user who already has an actor before the migration runs',
        should: 'leave their existing actor id untouched, not add a second',
        actual: [count, row?.id],
        expected: [1, existingActorId],
      });
    });
  });
});

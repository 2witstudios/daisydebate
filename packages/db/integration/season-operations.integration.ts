import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withSeasons } from '../src/seasons';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const october = new Date('2026-10-01T00:00:00.000Z');
const january = new Date('2027-01-01T00:00:00.000Z');

/** A season id this test owns; the fixture deletes it afterwards. */
const tracked = (fixture: Fixture) => {
  const id = createId();
  fixture.track('seasons', id);
  return id;
};

const statusOf = async (fixture: Fixture, id: string) => {
  const [row] = (await fixture.sql.unsafe(
    'select status, ends_at from seasons where id = $1',
    [id],
  )) as Array<{ status: string; ends_at: Date | null }>;
  return row
    ? { status: row.status, endsAt: row.ends_at?.toISOString() }
    : null;
};

describe('season operations (RATE-1.2)', () => {
  test('opens one active season and refuses a second', async () => {
    await withFixture(url, async (fixture) => {
      const first = tracked(fixture);
      const second = tracked(fixture);
      await withSeasons(url, async (seasons) => {
        const opened = await seasons.openSeason({
          id: first,
          name: 'Season 1',
          startsAt: october,
        });
        assert({
          given: 'no active season',
          should: 'open the season as active at version 1',
          actual: [opened.status, opened.name, opened.version, opened.endsAt],
          expected: ['active', 'Season 1', 1, null],
        });
        await assertRejects({
          given: 'an active season already open',
          should: 'refuse a second as a conflict',
          actual: () =>
            seasons.openSeason({ id: second, name: 'Two', startsAt: january }),
          code: 'CONFLICT',
        });
        assert({
          given: 'a refused second season',
          should: 'write nothing for it',
          actual: await statusOf(fixture, second),
          expected: null,
        });
        assert({
          given: 'the open season',
          should: 'list it',
          actual: (await seasons.listSeasons()).some(({ id }) => id === first),
          expected: true,
        });
      });
    });
  });

  test('closes only an active season after its start', async () => {
    await withFixture(url, async (fixture) => {
      const id = tracked(fixture);
      await withSeasons(url, async (seasons) => {
        await seasons.openSeason({ id, name: 'Season 1', startsAt: october });
        await assertRejects({
          given: 'an end before the start',
          should: 'refuse as invalid',
          actual: () => seasons.closeSeason({ id, endsAt: october }),
          code: 'VALIDATION',
        });
        const closed = await seasons.closeSeason({ id, endsAt: january });
        assert({
          given: 'an active season and a later end',
          should: 'close it with that end and bump its version',
          actual: [closed.status, closed.endsAt, closed.version],
          expected: ['closed', january.toISOString(), 2],
        });
        await assertRejects({
          given: 'a season that is already closed',
          should: 'refuse as a conflict',
          actual: () => seasons.closeSeason({ id, endsAt: january }),
          code: 'CONFLICT',
        });
        await assertRejects({
          given: 'an unknown season id',
          should: 'refuse as not found',
          actual: () =>
            seasons.closeSeason({ id: createId(), endsAt: january }),
          code: 'NOT_FOUND',
        });
      });
    });
  });

  test('rolls over atomically', async () => {
    await withFixture(url, async (fixture) => {
      const current = tracked(fixture);
      const next = tracked(fixture);
      const refused = tracked(fixture);
      await withSeasons(url, async (seasons) => {
        await seasons.openSeason({
          id: current,
          name: 'Season 1',
          startsAt: october,
        });
        await assertRejects({
          given: 'a next season starting before the current one',
          should: 'refuse the rollover as invalid',
          actual: () =>
            seasons.rolloverSeason({
              closeId: current,
              open: {
                id: refused,
                name: 'Too early',
                startsAt: new Date('2026-09-01T00:00:00.000Z'),
              },
            }),
          code: 'VALIDATION',
        });
        assert({
          given: 'a refused rollover',
          should: 'leave the current season active and open nothing',
          actual: [
            await statusOf(fixture, current),
            await statusOf(fixture, refused),
          ],
          expected: [{ status: 'active', endsAt: undefined }, null],
        });
        const { closed, opened } = await seasons.rolloverSeason({
          closeId: current,
          open: { id: next, name: 'Season 2', startsAt: january },
        });
        assert({
          given: 'a rollover to a later season',
          should:
            'close the current season at the next start and open the next',
          actual: [closed.status, closed.endsAt, opened.status, opened.id],
          expected: ['closed', january.toISOString(), 'active', next],
        });
      });
    });
  });
});

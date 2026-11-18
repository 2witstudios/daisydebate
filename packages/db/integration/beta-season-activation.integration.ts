import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSeasons } from '../src/seasons';
import { withFixture } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('concurrent activation, reconnect and closed-season retry preserve one actual Season1', async () => {
  await withFixture(url, async (f) => {
    const ids = [createId(), createId()];
    ids.forEach((id) => f.track('seasons', id));
    const [started] = await f.sql`select clock_timestamp() as at`;
    const results = await Promise.all(
      ids.map((id) =>
        withSeasons(url, (s) => s.activateBetaSeason({ id, division: 'open' })),
      ),
    );
    const first = results[0]!;
    const [bounds] = await f.sql`select clock_timestamp() as now`;
    assert({
      given: 'concurrent activation with distinct candidate IDs',
      should: 'return the same single season started at actual activation',
      actual: [
        results[1],
        first.name,
        Date.parse(first.startsAt) >= new Date(started!.at).getTime() &&
          Date.parse(first.startsAt) <= new Date(bounds!.now).getTime(),
      ],
      expected: [first, 'Season 1', true],
    });
    const actorId = await f.actor();
    await f.insert(
      'ratings',
      {
        actor_id: actorId,
        ladder: 'freestyle',
        division: 'open',
        season_id: first.id,
        rating: 1666.125,
        deviation: 108.75,
        volatility: 0.06,
        version: 7,
      },
      'actor_id',
    );
    const before =
      await f.sql`select to_jsonb(r) as state from ratings r where actor_id=${actorId}`;
    const activeRetry = await withSeasons(url, (s) =>
      s.activateBetaSeason({ id: createId(), division: 'open' }),
    );
    assert({
      given: 'an active Season1 with a real populated standing',
      should: 'preserve season identity and every standing field on retry',
      actual: [
        activeRetry,
        await f.sql`select to_jsonb(r) as state from ratings r where actor_id=${actorId}`,
      ],
      expected: [first, before],
    });
    await f.sql`update seasons set status='closed', ends_at=${new Date(Date.parse(first.startsAt) + 1)} where id=${first.id}`;
    const retried = await withSeasons(url, (s) =>
      s.activateBetaSeason({ id: createId(), division: 'open' }),
    );
    assert({
      given: 'a reconnect and retry after Season1 closes',
      should:
        'return the original closed season without resetting or rolling over',
      actual: [
        retried.id,
        retried.startsAt,
        retried.status,
        (
          await f.sql`select id from seasons where activation_key='beta-season-1'`
        ).length,
      ],
      expected: [first.id, first.startsAt, 'closed', 1],
    });
    assert({
      given: 'a closed-season activation retry',
      should: 'also preserve the competitive standing unchanged',
      actual:
        await f.sql`select to_jsonb(r) as state from ratings r where actor_id=${actorId}`,
      expected: before,
    });
  });
});

test('activation refuses a competing season unchanged', async () => {
  await withFixture(url, async (f) => {
    const id = createId();
    await f.insert('seasons', {
      division: 'open',
      id,
      name: 'Other',
      starts_at: new Date('2026-01-01T00:00:00.000Z'),
      status: 'closed',
      ends_at: new Date('2026-02-01T00:00:00.000Z'),
    });
    await assertRejects({
      given: 'a competing season identity',
      should: 'refuse beta activation without inventing history',
      actual: () =>
        withSeasons(url, (s) =>
          s.activateBetaSeason({ id: createId(), division: 'open' }),
        ),
      code: 'CONFLICT',
    });
    assert({
      given: 'a refused activation',
      should: 'preserve the existing season only',
      actual: (await f.sql`select id from seasons`).map(
        (r: { id: string }) => r.id,
      ),
      expected: [id],
    });
  });
});

test('each division activates its own Season 1 beside the other (ADR 0147)', async () => {
  await withFixture(url, async (f) => {
    const [openId, youthId] = [createId(), createId()];
    f.track('seasons', openId);
    f.track('seasons', youthId);
    const open = await withSeasons(url, (s) =>
      s.activateBetaSeason({ id: openId, division: 'open' }),
    );
    const youth = await withSeasons(url, (s) =>
      s.activateBetaSeason({ id: youthId, division: 'youth' }),
    );
    const youthRetry = await withSeasons(url, (s) =>
      s.activateBetaSeason({ id: createId(), division: 'youth' }),
    );
    assert({
      given: 'an active Open Season 1, then a Youth activation and its retry',
      should:
        'open one Youth Season 1 beside it, each active on its own division',
      actual: [
        [open.division, open.status],
        [youth.id, youth.division, youth.status, youth.name],
        youthRetry.id,
        (
          await f.sql`select division from seasons where status='active' order by division`
        ).map((row: { division: string }) => row.division),
      ],
      expected: [
        ['open', 'active'],
        [youthId, 'youth', 'active', 'Season 1'],
        youthId,
        ['open', 'youth'],
      ],
    });
  });
});

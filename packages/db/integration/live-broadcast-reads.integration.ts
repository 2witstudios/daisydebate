import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { liveBroadcastReads } from '../src/live-broadcast-reads';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Everything here is relative to this read instant, far from other suites' rows. */
const now = new Date('2031-03-03T12:00:00.000Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
const clock = { now: now.toISOString(), rankedDelaySeconds: 60 };
const NEVER = { mode: 'any', q: '' } as const;

type Broadcast = {
  readonly released?: Date | null;
  readonly stopped?: Date | null;
  readonly completed?: Date | null;
  readonly policy?: Record<string, unknown>;
};

type AddInput = {
  readonly title?: string;
  readonly visibility?: 'public' | 'unlisted' | 'private';
  readonly startedAt?: Date;
  readonly broadcast?: Broadcast | null;
  readonly ended?: Date;
};

const withLive = async (
  run: (reads: {
    readonly add: (
      input: AddInput,
    ) => Promise<{ roundId: string; aff: string }>;
    readonly list: (
      over?: Partial<
        Parameters<
          ReturnType<typeof liveBroadcastReads>['listLiveBroadcasts']
        >[0]
      >,
    ) => Promise<readonly string[]>;
    readonly raw: ReturnType<typeof liveBroadcastReads>;
    readonly mine: Set<string>;
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 2 });
  const raw = liveBroadcastReads({ database: drizzle({ client }) });
  const mine = new Set<string>();
  try {
    await withFixture(databaseUrl, async (f) => {
      const formatId = await f.format();
      const host = await f.actor(await f.user());
      const created: string[] = [];
      const add = async ({
        title = 'A Room',
        visibility = 'public',
        startedAt = ago(300),
        broadcast = { released: ago(60) },
        ended,
      }: AddInput) => {
        const room = await f.room(host, formatId, { title });
        const roundId = await f.round({
          room_id: room,
          visibility,
          room_config_snapshot: {},
          status: ended ? 'completed' : 'active',
          current_stage: ended ? null : 'live',
          outcome: ended ? 'affirmative' : null,
          started_at: startedAt,
          completed_at: ended ?? null,
        });
        created.push(roundId);
        mine.add(roundId);
        const seat = await f.seat(roundId, 'affirmative');
        await f.seat(roundId, 'negative');
        const [named] = await client<{ username: string }[]>`
          select u.username from users u join actors a on a.user_id=u.id
          where a.id=${seat.actorId}`;
        if (broadcast)
          await client`insert into broadcasts (id,round_id,feed_key,release_policy,released_through_at,stopped_at,stop_reason,completed_at)
            values (${createId()},${roundId},${createId()},${broadcast.policy ?? { kind: 'delay', seconds: 60 }},
              ${broadcast.released ?? null},${broadcast.stopped ?? null},
              ${broadcast.stopped ? 'moderation' : null},${broadcast.completed ?? null})`;
        return { roundId, aff: named?.username ?? '' };
      };
      const list = async (over = {}) => {
        const { rows } = await raw.listLiveBroadcasts({
          filter: NEVER,
          before: '',
          clock,
          limit: 100,
          ...over,
        });
        return rows.map((row) => row.id).filter((id) => mine.has(id));
      };
      try {
        await run({ add, list, raw, mine });
      } finally {
        for (const id of created)
          await client`delete from broadcasts where round_id=${id}`;
      }
    });
  } finally {
    await client.close();
  }
};

test('only a public Round whose start the audience has reached is on Live', async () => {
  await withLive(async ({ add, list }) => {
    const live = await add({});
    await add({ visibility: 'private' });
    await add({ visibility: 'unlisted' });
    await add({ broadcast: null });
    await add({ broadcast: { released: null } });
    await add({ startedAt: ago(30) });
    await add({
      broadcast: { released: null, policy: { kind: 'round_end' } },
    });
    await add({ broadcast: { released: ago(60), stopped: ago(10) } });
    await add({ broadcast: { released: ago(60), completed: ago(10) } });
    await add({
      startedAt: ago(900),
      ended: ago(600),
      broadcast: { released: ago(60) },
    });
    assert({
      given:
        'a public Round on air, then private, unlisted, unbroadcast, unreleased, just started, held, stopped, finished and released-ended ones',
      should: 'list only the one on air',
      actual: await list(),
      expected: [live.roundId],
    });
  });
});

test('a Round stays on Live until its end has been released', async () => {
  await withLive(async ({ add, list }) => {
    const endingNow = await add({ ended: ago(10) });
    assert({
      given: 'a Round that ended 10 seconds ago, inside the delay',
      should: 'still be live for the audience, with its end unseen',
      actual: await list(),
      expected: [endingNow.roundId],
    });
  });
});

test('a row carries real labels, and the latest released speech only', async () => {
  await withLive(async ({ add, raw, mine }) => {
    const { roundId, aff } = await add({ title: 'Friday night' });
    const client = new SQL(databaseUrl, { max: 1 });
    try {
      for (const [sequence, key, startedAt, endedAt] of [
        [0, '1AC', ago(200), ago(150)],
        [1, '1NC', ago(100), ago(50)],
        [2, '2AC', ago(10), null],
      ] as const)
        await client`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms)
          values (${createId()},${roundId},${sequence},'speech',${key},${startedAt},${endedAt},60000)`;
    } finally {
      await client.close();
    }
    const { rows } = await raw.listLiveBroadcasts({
      filter: NEVER,
      before: '',
      clock,
      limit: 100,
    });
    const row = rows.find((candidate) => mine.has(candidate.id));
    assert({
      given: 'three speeches, the newest not yet reached by the watermark',
      should: 'carry the newest released one, the title and seat labels',
      actual: [
        row?.title,
        row?.segments.map((segment) => segment.key),
        row?.seats.map((seat) => seat.side),
        row?.seats[0]?.username,
      ],
      expected: ['Friday night', ['1NC'], ['affirmative', 'negative'], aff],
    });
  });
});

test('filters, search, seats and paging run in the read', async () => {
  await withLive(async ({ add, list, raw, mine }) => {
    const first = await add({ title: 'Alpha room', startedAt: ago(300) });
    const second = await add({ title: 'Beta room', startedAt: ago(200) });
    assert({
      given: 'a search by title and by a debater',
      should: 'find each Round, and a percent sign matches nothing wild',
      actual: [
        await list({ filter: { mode: 'any', q: 'alpha' } }),
        await list({ filter: { mode: 'any', q: first.aff } }),
        await list({ filter: { mode: 'any', q: '%' } }),
      ],
      expected: [[first.roundId], [first.roundId], []],
    });
    assert({
      given: 'the mode filter',
      should: 'keep casual Rounds and drop them for ranked',
      actual: [
        (await list({ filter: { mode: 'casual', q: '' } })).length,
        await list({ filter: { mode: 'ranked', q: '' } }),
      ],
      expected: [2, []],
    });
    assert({
      given: 'a named debater, and an empty list of names',
      should: 'find only their Round, then nothing',
      actual: [
        await list({ seatedUsernames: [second.aff] }),
        await list({ seatedUsernames: [] }),
      ],
      expected: [[second.roundId], []],
    });
    const onePage = await raw.listLiveBroadcasts({
      filter: NEVER,
      before: first.roundId,
      clock,
      limit: 100,
    });
    assert({
      given: 'a cursor at the oldest of mine',
      should: 'not repeat it, or the newer one',
      actual: onePage.rows.filter((row) => mine.has(row.id)).length,
      expected: 0,
    });
    const newestFirst = await list();
    assert({
      given: 'no cursor',
      should: 'order newest start first',
      actual: newestFirst,
      expected: [second.roundId, first.roundId],
    });
  });
});

test('the count agrees with the listing', async () => {
  await withLive(async ({ add, raw }) => {
    const before = await raw.countLiveBroadcasts({ clock });
    await add({});
    await add({ visibility: 'private' });
    assert({
      given: 'one more listed Round and one private one',
      should: 'count one more',
      actual: (await raw.countLiveBroadcasts({ clock })) - before,
      expected: 1,
    });
  });
});

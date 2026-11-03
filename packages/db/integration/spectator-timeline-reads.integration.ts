import { requireTestServices } from '@daisy/config';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { spectatorTimelineReads } from '../src/spectator-timeline-reads';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const started = new Date('2026-11-02T00:00:00.000Z');
const spoken = new Date('2026-11-02T00:00:30.000Z');
const later = new Date('2026-11-02T00:01:00.000Z');

const withLiveRound = async (
  competitionType: 'ranked' | 'casual',
  run: (
    read: (horizonMs: number | null) => Promise<unknown>,
    round: { readonly client: SQL; readonly roundId: string },
  ) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 2 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const formatId = await f.format();
      const host = await f.actor(await f.user());
      const room = await f.room(host, formatId);
      const roundId = await f.round({
        room_id: room,
        visibility: 'public',
        room_config_snapshot: {},
        status: 'active',
        current_stage: 'live',
        started_at: started,
        ...(competitionType === 'ranked'
          ? {
              competition_type: 'ranked',
              format_id: 'freestyle',
              preset_version: 1,
              ladder_id: 'freestyle',
            }
          : {}),
      });
      const seat = await f.seat(roundId, 'affirmative');
      const segment = createId();
      await client`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,duration_ms)
        values (${segment},${roundId},0,'speech','1AC',${started},60000)`;
      for (const [sequence, text, at] of [
        [0, 'An early line', spoken],
        [1, 'A later line', later],
      ] as const)
        await client`insert into utterances (id,round_id,segment_id,round_participant_id,sequence,text,created_at)
          values (${createId()},${roundId},${segment},${seat.id},${sequence},${text},${at})`;
      const { readSpectatorTimeline } = spectatorTimelineReads({
        database: drizzle({ client }),
      });
      try {
        await run(
          (horizonMs) =>
            readSpectatorTimeline({ roundId, horizonOf: () => horizonMs }),
          { client, roundId },
        );
      } finally {
        await client`delete from utterances where round_id=${roundId}`;
        await client`delete from round_segments where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
};
const captions = (read: unknown) =>
  (read as { captions: { text: string }[] }).captions.map((c) => c.text);
const margin = (at: Date) => at.getTime() + SPECTATOR_MARGIN_MS;

test('ranked captions follow the horizon, line by line', async () => {
  await withLiveRound('ranked', async (read) => {
    assert({
      given: 'no horizon, one short of a line by a millisecond, then past it',
      should: 'caption nothing, nothing, then that line alone',
      actual: [
        captions(await read(null)),
        captions(await read(margin(spoken) - 1)),
        captions(await read(margin(spoken))),
      ],
      expected: [[], [], ['An early line']],
    });
    assert({
      given: 'a horizon past both lines',
      should: 'caption them in the order they were said',
      actual: captions(await read(margin(later))),
      expected: ['An early line', 'A later line'],
    });
  });
});

test('a non-ranked Round has no captions (DEC-301)', async () => {
  await withLiveRound('casual', async (read) => {
    assert({
      given: 'a casual Round past every line',
      should: 'caption nothing',
      actual: captions(await read(margin(later))),
      expected: [],
    });
  });
});

test('a line on a segment still open past the last heartbeat waits, like its media', async () => {
  await withLiveRound('ranked', async (read, { client, roundId }) => {
    const id = createId();
    await client`insert into broadcasts (id,round_id,feed_key,release_policy,egress_id,control_heartbeat_at)
      values (${id},${roundId},${createId()},jsonb_build_object('kind','delay','seconds',60),'EG',${new Date(spoken.getTime() - 1000)})`;
    const unheard = captions(await read(margin(spoken)));
    await client`update broadcasts set control_heartbeat_at=${spoken} where id=${id}`;
    const heard = captions(await read(margin(spoken)));
    await client`update broadcasts set control_heartbeat_at=${new Date(spoken.getTime() - 1000)} where id=${id}`;
    await client`update round_segments set ended_at=${later} where round_id=${roundId}`;
    const closed = captions(await read(margin(spoken)));
    await client`delete from broadcasts where id=${id}`;
    assert({
      given:
        'the line past the last heartbeat, then heard, then unheard on a closed segment',
      should: 'hold it, then caption it, and a commit proves it too',
      actual: [unheard, heard, closed],
      expected: [[], ['An early line'], ['An early line']],
    });
  });
});

test('after a takedown the text is hidden from the audience', async () => {
  await withLiveRound('ranked', async (read, { client, roundId }) => {
    const id = createId();
    const at = spoken.toISOString();
    await client`insert into recordings (id,round_id,class,status,eligibility,lifecycle)
      values (${id},${roundId},'ranked','taken_down',
        jsonb_build_object('kind','ranked'),
        ${JSON.stringify({ status: 'taken_down', takenDownAt: at, held: null })}::text::jsonb)`;
    const hidden = captions(await read(margin(spoken)));
    await client`delete from recordings where id=${id}`;
    assert({
      given: 'a released line on a Round whose Recording is taken down',
      should: 'caption nothing, whatever the horizon',
      actual: [hidden, captions(await read(margin(spoken)))],
      expected: [[], ['An early line']],
    });
  });
});

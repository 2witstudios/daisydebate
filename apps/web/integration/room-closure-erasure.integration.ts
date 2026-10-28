import { requireTestServices } from '@daisy/config';
import { eraseRoomClosureSubject } from '@daisy/db/testing';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawRoomAt } from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const SENTINEL = 'SENTINEL-HOST-LINE';
const lines = [1, 2, 3, 4, 5].map((n) => `${SENTINEL} ${n}`);
const host = { kind: 'host' as const, resolutions: lines };
const bank = {
  kind: 'bank' as const,
  categories: ['policy' as const, 'value' as const],
};
const transitions = { closeRoom, eraseSeats, activeRoomMembers };

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const erase = (f: Fixture, subject: { userId: string; actorId: string }) =>
  eraseRoomClosureSubject(
    f.sql,
    transitions,
    subject,
    new Date().toISOString(),
  );

/** Every durable copy of a Room's draw and its Round, as counts and text. */
const footprint = async (f: Fixture, roomId: string) => {
  const [row] = await f.sql`select
    r.status, r.topic, r.change_version,
    r.config::text || r.execution_plan::text as config,
    (select count(*)::int from room_participants p where p.room_id = r.id) seats,
    (select string_agg(i.text, '|' order by i.position) from room_resolution_draw_items i join room_resolution_draws d on d.id = i.draw_id where d.room_id = r.id) items,
    (select count(*)::int from room_resolution_draw_inputs n join room_resolution_draws d on d.id = n.draw_id where d.room_id = r.id) room_inputs,
    (select count(*)::int from room_resolution_draws d where d.room_id = r.id) draws,
    (select resolution from rounds where room_id = r.id) round_resolution,
    (select count(*)::int from round_resolution_draw_texts t join rounds o on o.id = t.round_id where o.room_id = r.id) round_texts,
    (select count(*)::int from round_draw_private_inputs t join rounds o on o.id = t.round_id where o.room_id = r.id) round_inputs,
    (select count(*)::int from round_draw_seeds t join rounds o on o.id = t.round_id where o.room_id = r.id) round_seeds,
    (select resolution_evidence is not null from rounds where room_id = r.id) evidence
    from rooms r where r.id = ${roomId}`;
  return row;
};
/** A ready, a mid-strike and a launched host-list draw, one role closed in each. */
const closedAtEachStage = async (f: Fixture, role: 'host' | 'guest') => {
  const rooms = [];
  for (const stage of ['ready', 'striking', 'launched'] as const)
    rooms.push(await drawRoomAt(f, stage, host));
  const before = await Promise.all(
    rooms.map(({ view }) => footprint(f, view.id)),
  );
  for (const { cast } of rooms) await erase(f, cast[role]);
  const after = await Promise.all(
    rooms.map(({ view }) => footprint(f, view.id)),
  );
  return { before, after };
};
/** The draw's durable copies, without the Room's lifecycle and seats. */
const copies = (row: Awaited<ReturnType<typeof footprint>>) => ({
  topic: row?.topic,
  items: row?.items,
  draws: row?.draws,
  roomInputs: row?.room_inputs,
  roundResolution: row?.round_resolution,
  roundTexts: row?.round_texts,
  roundInputs: row?.round_inputs,
  roundSeeds: row?.round_seeds,
  evidence: row?.evidence,
});
const holds = (value: unknown) => JSON.stringify(value).includes(SENTINEL);

test('closing the host-list author closes their open Rooms and keeps every line on the record', async () => {
  await withRoomRuntime(async (f) => {
    const { before, after } = await closedAtEachStage(f, 'host');
    const [r, s, l] = after;
    assert({
      given:
        'the author of a ready, a mid-strike and a launched host-list draw',
      should:
        'close the open Rooms and leave the launched one started (ADR 0087)',
      actual: [r?.status, s?.status, l?.status, after.every(holds)],
      expected: ['closed', 'closed', 'started', true],
    });
    assert({
      given: 'every Room and Round copy of the draw',
      should:
        'keep the drawn texts, private inputs, seeds and debated resolution unchanged',
      actual: after.map(copies),
      expected: before.map(copies),
    });
  });
});

test('closing a seated player frees their seats only before any pre-round and keeps the draw', async () => {
  await withRoomRuntime(async (f) => {
    const { before, after } = await closedAtEachStage(f, 'guest');
    assert({
      given: 'the Negative of a ready, a mid-strike and a launched draw',
      should: 'remove the unbegun seat and keep begun seats',
      actual: after.map((row) => [row?.seats, row?.status]),
      expected: [
        [1, 'assembling'],
        [before[1]?.seats, before[1]?.status],
        [before[2]?.seats, before[2]?.status],
      ],
    });
    assert({
      given: 'every Room and Round copy of the draw',
      should: 'leave each one unchanged',
      actual: after.map(copies),
      expected: before.map(copies),
    });
  });
});

test('closing the host of a launched bank draw rewrites nothing', async () => {
  await withRoomRuntime(async (f) => {
    const launched = await drawRoomAt(f, 'launched', bank);
    const before = await footprint(f, launched.view.id);
    await erase(f, launched.cast.host);
    const after = await footprint(f, launched.view.id);
    assert({
      given: 'a launched bank draw whose host is closed',
      should: 'leave the Room and its Round exactly as they were',
      actual: after,
      expected: before,
    });
  });
});

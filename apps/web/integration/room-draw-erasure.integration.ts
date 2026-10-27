import { requireTestServices } from '@daisy/config';
import { eraseRoomDrawSubject } from '@daisy/db/testing';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawRoomAt } from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const SENTINEL = 'SENTINEL-ERASED-LINE';
const lines = [1, 2, 3, 4, 5].map((n) => `${SENTINEL} ${n}`);
const host = { kind: 'host' as const, resolutions: lines };
const bank = {
  kind: 'bank' as const,
  categories: ['policy' as const, 'value' as const],
};
const transitions = { closeRoom, eraseSeats, activeRoomMembers };

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const erase = (f: Fixture, subject: { userId: string; actorId: string }) =>
  eraseRoomDrawSubject(f.sql, transitions, subject, new Date().toISOString());

/** Every durable copy of a Room's draw and its Round, as counts and text. */
const footprint = async (f: Fixture, roomId: string) => {
  const [row] = await f.sql`select
    r.status, r.topic,
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
/** A ready, a mid-strike and a launched host-list draw, one role erased in each. */
const erasedAtEachStage = async (f: Fixture, role: 'host' | 'guest') => {
  const rooms = [];
  for (const stage of ['ready', 'striking', 'launched'] as const)
    rooms.push(await drawRoomAt(f, stage, host));
  for (const { cast } of rooms) await erase(f, cast[role]);
  return Promise.all(rooms.map(({ view }) => footprint(f, view.id)));
};
const holds = (value: unknown) => JSON.stringify(value).includes(SENTINEL);

test('erasing the host-list author scrubs every copy of their lines at every stage', async () => {
  await withRoomRuntime(async (f) => {
    const [r, s, l] = await erasedAtEachStage(f, 'host');
    assert({
      given:
        'the author of a ready, a mid-strike and a launched host-list draw',
      should:
        'close the open Rooms and leave no line of theirs in any Room or Round copy',
      actual: [r.status, s.status, l.status, [r, s, l].some(holds)],
      expected: ['abandoned', 'abandoned', 'started', false],
    });
    assert({
      given: 'the mid-strike and launched Rooms',
      should:
        'keep the draw proof, placeholder the drawn texts and delete the private inputs',
      actual: [
        [s.draws, s.room_inputs, s.items?.startsWith('Removed resolution')],
        [l.draws, l.room_inputs, l.round_inputs, l.round_texts, l.round_seeds],
        [l.evidence, l.round_resolution?.startsWith('Removed resolution')],
        l.topic === l.round_resolution,
      ],
      expected: [[1, 0, true], [1, 0, 0, 0, 1], [true, true], true],
    });
  });
});

test('erasing a seated player removes their seats only before any pre-round and deletes draw inputs', async () => {
  await withRoomRuntime(async (f) => {
    const [r, s, l] = await erasedAtEachStage(f, 'guest');
    assert({
      given: 'the Negative of a ready, a mid-strike and a launched draw',
      should:
        'remove the unbegun seat, keep begun seats, delete private inputs and keep the host-authored texts',
      actual: [
        [r.seats, r.status],
        [s.seats, s.room_inputs, s.items?.split('|').length],
        [l.round_inputs, l.round_texts, l.round_seeds, l.evidence],
      ],
      expected: [
        [1, 'assembling'],
        [2, 0, 5],
        [0, 5, 1, true],
      ],
    });
  });
});

test('a bank draw keeps Daisy-authored texts when its host is erased', async () => {
  await withRoomRuntime(async (f) => {
    const launched = await drawRoomAt(f, 'launched', bank);
    const before = await footprint(f, launched.view.id);
    await erase(f, launched.cast.host);
    const after = await footprint(f, launched.view.id);
    assert({
      given: 'a launched bank draw whose host is erased',
      should:
        'keep the bank texts and the debated resolution, deleting only the private inputs',
      actual: [
        after.items === before.items,
        after.round_texts,
        after.round_resolution === before.round_resolution,
        after.round_inputs,
      ],
      expected: [true, 5, true, 0],
    });
  });
});

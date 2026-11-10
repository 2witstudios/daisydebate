import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { seatsHeldFrom } from './room-edit-transitions';

setupRitewayBun();

const until = '2999-01-01T00:00:00.000Z';
const human = (actorId: string) => ({
  id: 'candidate',
  actorId,
  label: actorId,
  kind: 'human' as const,
  role: 'negative' as const,
  slot: 0,
  eligible: true,
  seatRole: null,
  consentVersion: 0,
  consentCommandId: null,
});
type Hold = {
  actorId: string;
  until: string;
  seat?: 'debater' | 'judge';
};
const held = (holds: readonly Hold[]) => {
  const base = state();
  return {
    ...base,
    participants: [],
    status: 'assembling' as const,
    rules: { ...base.rules, seats: { ...base.rules.seats, judge: 1 } },
    seatHolds: holds.map((hold) => ({ seat: 'debater' as const, ...hold })),
  };
};
const claim = (
  room: ReturnType<typeof held>,
  actorId: string,
  role: 'affirmative' | 'negative' | 'judge' = 'negative',
) =>
  executeRoomCommand(
    room,
    actorId,
    {
      type: 'claim-seat',
      commandId: 'claim',
      expectedVersion: room.version,
      role,
      slot: 0,
    },
    consent,
    {
      ...edges,
      now: '2026-11-02T00:00:00.000Z',
      participantId: 'candidate',
      target: { ...human(actorId), role },
    },
  );

test('a held debater seat goes only to the member it is held for', () => {
  const room = held([
    { actorId: 'ada', until },
    { actorId: 'bea', until },
  ]);
  assert({
    given: 'both debater seats held for two members',
    should: 'refuse a third member and admit each named one',
    actual: [
      claim(room, 'carl'),
      claim(room, 'ada').ok,
      claim(room, 'bea', 'affirmative').ok,
    ],
    expected: [{ ok: false, refusal: 'seat-unavailable' }, true, true],
  });
});

test('a debater hold never touches the judge seat', () => {
  const room = held([
    { actorId: 'ada', until },
    { actorId: 'bea', until },
  ]);
  assert({
    given: 'both debater seats held and a free judge seat',
    should: 'let anyone take the judge seat',
    actual: claim(room, 'carl', 'judge').ok,
    expected: true,
  });
});

test('a judge hold keeps the judge seat for the invited judge', () => {
  const room = held([{ actorId: 'jo', until, seat: 'judge' }]);
  const assign = (actorId: string) =>
    executeRoomCommand(
      room,
      room.hostActorId,
      {
        type: 'assign-seat',
        commandId: 'assign',
        expectedVersion: room.version,
        role: 'judge',
        slot: 0,
        actorId,
      },
      consent,
      {
        ...edges,
        now: '2026-11-02T00:00:00.000Z',
        participantId: 'candidate',
        target: { ...human(actorId), role: 'judge' },
      },
    );
  assert({
    given: 'the one judge seat held for an invited judge',
    should:
      'refuse another member, refuse the host seating someone else, admit the judge, and leave debater seats open',
    actual: [
      claim(room, 'carl', 'judge'),
      assign('carl').ok,
      claim(room, 'jo', 'judge').ok,
      claim(room, 'carl', 'negative').ok,
    ],
    expected: [{ ok: false, refusal: 'seat-unavailable' }, false, true, true],
  });
});

test('a hold ends with its time', () => {
  const room = held([
    { actorId: 'ada', until: '2026-11-01T00:00:00.000Z' },
    { actorId: 'bea', until: '2026-11-01T00:00:00.000Z' },
  ]);
  assert({
    given: 'holds that ran out',
    should: 'open the seats to anyone',
    actual: [
      claim(room, 'carl').ok,
      seatsHeldFrom(room, 'carl', 'debater', '2026-11-02T00:00:00.000Z'),
    ],
    expected: [true, 0],
  });
});

test('a member who arrived holds nothing back', () => {
  const room = {
    ...held([
      { actorId: 'ada', until },
      { actorId: 'bea', until },
    ]),
    participants: [{ ...human('ada'), id: 'seat-a' }],
  };
  assert({
    given: 'one named member seated and one on the way',
    should: 'keep one seat from a stranger and none from the other member',
    actual: [
      seatsHeldFrom(room, 'carl', 'debater', '2026-11-02T00:00:00.000Z'),
      seatsHeldFrom(room, 'bea', 'debater', '2026-11-02T00:00:00.000Z'),
    ],
    expected: [1, 0],
  });
});

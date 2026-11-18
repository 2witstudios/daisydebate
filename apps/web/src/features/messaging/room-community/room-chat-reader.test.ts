import type { RoomView, SeatRef } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomChatHint, roomChatReaderOf } from './room-chat-reader';

setupRitewayBun();
const seat = (
  actorId: string,
  seat: SeatRef,
  division: 'open' | 'youth' | null = null,
) =>
  ({
    actorId,
    kind: 'human',
    seat,
    division,
  }) as RoomView['participants'][number];
const anonymousJudge = {
  anonymous: true,
  kind: 'human',
  seat: { kind: 'judge', slot: 1 },
} as RoomView['participants'][number];
const roomOf = (
  division: 'open' | 'youth',
  competitionType: RoomView['competitionType'] = 'ranked',
): Pick<RoomView, 'participants' | 'hostActorId' | 'competitionType'> => ({
  hostActorId: 'host',
  competitionType,
  participants: [
    seat('debater', { kind: 'side', side: 'affirmative', slot: 0 }, division),
    seat('judge', { kind: 'judge', slot: 0 }),
    anonymousJudge,
  ],
});

test('who reads Room chat without posting, as the Room view shows it', () => {
  const viewers = ['debater', 'judge', 'host', 'visitor'];
  assert({
    given:
      'an Open ranked Room, a Youth ranked Room and a casual Room seating a youth debater, each with a debater, the viewer’s own judge seat, another judge the viewer may not name and a seatless host, seen by each and by a seatless visitor',
    should:
      'name the judge everywhere and the seatless visitor a spectator in the Youth Room only, never the debater or the host',
    actual: {
      open: viewers.map((v) => roomChatReaderOf(roomOf('open'), v)),
      youth: viewers.map((v) => roomChatReaderOf(roomOf('youth'), v)),
      casual: viewers.map((v) =>
        roomChatReaderOf(roomOf('youth', 'casual'), v),
      ),
    },
    expected: {
      open: [null, 'judge', null, null],
      youth: [null, 'judge', null, 'spectator'],
      casual: [null, 'judge', null, null],
    },
  });
});

test('the live Room page’s chat hint', () => {
  const youth = roomOf('youth');
  const paint = (
    readOnlyHint: boolean,
    reader: 'judge' | 'spectator' | null,
  ) => ({ readOnlyHint, reader });
  assert({
    given:
      'a Youth Room’s spectator the server painted read-only, the same viewer the server let post (club staff), a judge, a spectator who took a seat, and club staff first painted as a judge who then left the seat',
    should:
      'hold the spectator read-only, leave club staff posting, hold the judge whatever the server said, lift the hint from a seat, and not carry a judge’s first paint over to a seatless viewer',
    actual: [
      roomChatHint(youth, 'visitor', paint(true, 'spectator')),
      roomChatHint(youth, 'visitor', paint(false, 'spectator')),
      roomChatHint(youth, 'judge', paint(false, null)),
      roomChatHint(youth, 'debater', paint(true, 'spectator')),
      roomChatHint(youth, 'visitor', paint(true, 'judge')),
    ],
    expected: [
      { reader: 'spectator', readOnlyHint: true },
      { reader: 'spectator', readOnlyHint: false },
      { reader: 'judge', readOnlyHint: true },
      { reader: null, readOnlyHint: false },
      { reader: 'spectator', readOnlyHint: false },
    ],
  });
});

import type { RoomView, SeatRef } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomChatReaderOf } from './room-chat-reader';

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

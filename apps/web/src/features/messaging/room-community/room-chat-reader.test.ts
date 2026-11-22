import type { RoomView } from '@daisy/protocol/room-contract';
import type { SeatRef } from '@daisy/protocol/seats';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomChatHintOf, roomChatReaderOf } from './room-chat-reader';

setupRitewayBun();
const seat = (actorId: string, seat: SeatRef) =>
  ({
    actorId,
    kind: 'human',
    seat,
  }) as RoomView['participants'][number];
const anonymousJudge = {
  anonymous: true,
  kind: 'human',
  seat: { kind: 'judge', slot: 1 },
} as RoomView['participants'][number];
const roomOf = (
  ageRule: 'adults' | 'under-18',
): Pick<RoomView, 'participants' | 'hostActorId' | 'ageRule'> => ({
  hostActorId: 'host',
  ageRule,
  participants: [
    seat('debater', { kind: 'side', side: 'affirmative', slot: 0 }),
    seat('judge', { kind: 'judge', slot: 0 }),
    anonymousJudge,
  ],
});

test('who reads Room chat without posting, as the Room view shows it', () => {
  const viewers = ['debater', 'judge', 'host', 'visitor'];
  assert({
    given:
      'an Open Room and a Youth Room (ranked or casual, ADR 0162), each with a debater, the viewer’s own judge seat, another judge the viewer may not name and a seatless host, seen by each and by a seatless visitor',
    should:
      'name the judge everywhere and the seatless visitor a spectator in the Youth Room only, never the debater or the host',
    actual: {
      open: viewers.map((v) => roomChatReaderOf(roomOf('adults'), v)),
      youth: viewers.map((v) => roomChatReaderOf(roomOf('under-18'), v)),
    },
    expected: {
      open: [null, 'judge', null, null],
      youth: [null, 'judge', null, 'spectator'],
    },
  });
});

test('the Room page’s chat hint before the chat is found', () => {
  assert({
    given:
      'a judge whatever the server painted, a Youth Room spectator the server painted read-only, the same viewer the server let post (club staff), and a viewer the view names neither',
    should:
      'hold the judge and the server-confirmed spectator read-only, and keep the server’s writable first paint for club staff and everyone else',
    actual: [
      roomChatHintOf('judge', false),
      roomChatHintOf('spectator', true),
      roomChatHintOf('spectator', false),
      roomChatHintOf(null, true),
    ],
    expected: [true, true, false, false],
  });
});

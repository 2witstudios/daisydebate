import type { RoomView, SeatRef } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readsRoomChatOnly } from './room-chat-reader';

setupRitewayBun();
const seat = (actorId: string, seat: SeatRef) =>
  ({ actorId, seat }) as RoomView['participants'][number];
const view = {
  participants: [
    seat('debater', { kind: 'side', side: 'affirmative', slot: 0 }),
    seat('judge', { kind: 'judge', slot: 0 }),
    {
      anonymous: true,
      seat: { kind: 'judge', slot: 1 },
    } as RoomView['participants'][number],
  ],
};

test('who reads Room chat without posting', () => {
  assert({
    given:
      'a Room view with a debater, the viewer’s own judge seat and another judge the viewer may not name',
    should:
      'say so only for the viewer who holds a judge seat, never for a debater or a member with no seat',
    actual: ['debater', 'judge', 'visitor'].map((actorId) =>
      readsRoomChatOnly(view, actorId),
    ),
    expected: [false, true, false],
  });
});

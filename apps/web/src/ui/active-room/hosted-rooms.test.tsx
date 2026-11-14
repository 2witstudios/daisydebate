import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { HostedRooms, hostedWithoutSeat } from './hosted-rooms';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const room = (over: Partial<RoomListEntry>): RoomListEntry => ({
  id: id('a'),
  version: 1,
  title: 'Friday practice',
  topic: null,
  visibility: 'public',
  hostActorId: id('h'),
  hostLabel: 'host',
  status: 'assembling',
  competitionType: 'casual',
  seated: false,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 0,
  seatCount: 3,
  waitingSince: '2026-11-02T12:00:00.000Z',
  live: null,
  hostRating: null,
  ...over,
});

describe('hostedWithoutSeat (TAB-6.16)', () => {
  test('only the Rooms this member hosts and sits in no seat of', () => {
    const rooms = [
      room({ id: id('a') }),
      room({ id: id('b'), seated: true }),
      room({ id: id('c'), hostActorId: id('o') }),
    ];
    assert({
      given: 'a hosted Room, a hosted Room they sit in, and another host’s',
      should: 'list only the first; a visitor has none',
      actual: [
        hostedWithoutSeat(rooms, id('h')).map((entry) => entry.id),
        hostedWithoutSeat(rooms, null),
      ],
      expected: [[id('a')], []],
    });
  });

  test('the list links back to each Room', () => {
    const html = renderToStaticMarkup(<HostedRooms rooms={[room({})]} />);
    assert({
      given: 'one hosted Room',
      should: 'title the list and link to the Room with its state',
      actual: [
        html.includes('Rooms you host'),
        html.includes(`href="/rooms/${id('a')}"`),
        html.includes('Setting up'),
      ],
      expected: [true, true, true],
    });
  });
});

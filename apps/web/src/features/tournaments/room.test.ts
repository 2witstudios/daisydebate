import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleEvent } from '../../ui/mock/tournament-events';
import { NOW } from './tournament.test-support';
import {
  parseRoomState,
  roomFlow,
  roomHref,
  roomStates,
  type RoomState,
} from './room';

setupRitewayBun();

const data = sampleEvent(NOW);
if (!data) throw new Error('no sample event');
const screen = (state: RoomState) => roomFlow(data, state);

describe('parseRoomState and roomHref', () => {
  test('junk is not-ready; the default stays off the URL', () => {
    assert({
      given: 'nothing, a state, an array and junk',
      should: 'parse the first valid state',
      actual: [
        parseRoomState({}),
        parseRoomState({ state: 'absent' }),
        parseRoomState({ state: ['ready', 'absent'] }),
        parseRoomState({ state: 'x' }),
      ],
      expected: ['not-ready', 'absent', 'ready', 'not-ready'],
    });
    assert({
      given: 'the default and another state',
      should: 'build short URLs',
      actual: [
        roomHref('harvest-cup', 'semifinal-1', 'not-ready'),
        roomHref('harvest-cup', 'semifinal-1', 'ready'),
      ],
      expected: [
        '/tournaments/mine/harvest-cup/room/semifinal-1',
        '/tournaments/mine/harvest-cup/room/semifinal-1?state=ready',
      ],
    });
  });
});

describe('roomFlow', () => {
  test('seats: affirmative first, the viewer negative, readiness by state', () => {
    const seats = (state: RoomState) =>
      screen(state).seats.map(
        (seat) => `${seat.side} ${seat.handle} ${seat.status}`,
      );
    assert({
      given: 'each room state',
      should: 'list affirmative then negative with their status',
      actual: roomStates.map(seats),
      expected: [
        ['Affirmative debater-c Ready', 'Negative debater-a Not ready'],
        ['Affirmative debater-c Ready', 'Negative debater-a Ready'],
        ['Affirmative debater-c Ready', 'Negative debater-a Ready'],
        [
          'Affirmative debater-c Not checked in',
          'Negative debater-a Not ready',
        ],
      ],
    });
  });

  test('actions: ready link, waiting, countdown, forfeit window', () => {
    assert({
      given: 'each room state',
      should: 'offer I am ready, wait, count down, or hold the forfeit',
      actual: roomStates.map((state) => screen(state).action),
      expected: [
        {
          kind: 'ready',
          href: '/tournaments/mine/harvest-cup/room/semifinal-1?state=ready',
        },
        { kind: 'waiting', opponent: 'debater-c' },
        { kind: 'starting', seconds: 5 },
        { kind: 'absent', opponent: 'debater-c', claimAt: '12:28' },
      ],
    });
  });

  test('title, judge and audience', () => {
    const room = screen('not-ready');
    assert({
      given: 'the semifinal room',
      should: 'name it, the judge and the watchers',
      actual: [room.title, room.judge, room.watching],
      expected: ['Semifinal 1 room', 'judge-k', 31],
    });
  });
});

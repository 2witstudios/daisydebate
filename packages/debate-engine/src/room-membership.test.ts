import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { activeRoomMembers, projectActiveRoom } from './room-membership';
import { expireIdleRoom } from './room-expiry';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

const bot = {
  id: 'p3',
  actorId: 'bot',
  label: 'Bot',
  kind: 'bot' as const,
  role: 'judge' as const,
  slot: 0,
  eligible: true,
  consentVersion: 0,
  consentCommandId: null,
};
const withRound = (
  status: 'scheduled' | 'active' | 'completed' | 'abandoned',
): RoomAssemblyState => ({
  ...state(),
  status: 'started',
  roundRef: { id: 'round', status },
});

describe('one active Room per user', () => {
  test('an open or live Room holds its host and seated humans, never a bot', () => {
    const room = { ...state(), participants: [...state().participants, bot] };
    assert({
      given: 'an open Room with a bot judge, and a host who is not seated',
      should: 'hold the host and the seated humans once each',
      actual: [
        activeRoomMembers(room),
        activeRoomMembers({ ...room, hostActorId: 'watcher' }),
      ],
      expected: [
        ['host', 'other'],
        ['watcher', 'host', 'other'],
      ],
    });
    assert({
      given: 'a launched Room whose Round is scheduled or active',
      should: 'keep holding its members while the Round is live',
      actual: [
        activeRoomMembers(withRound('scheduled')),
        activeRoomMembers(withRound('active')),
      ],
      expected: [
        ['host', 'other'],
        ['host', 'other'],
      ],
    });
  });

  test('every terminal state frees the Room members', () => {
    assert({
      given: 'a closed Room and a launched Room whose Round completed or ended',
      should: 'hold no member',
      actual: [
        activeRoomMembers({ ...state(), status: 'abandoned' }),
        activeRoomMembers(withRound('completed')),
        activeRoomMembers(withRound('abandoned')),
      ],
      expected: [[], [], []],
    });
  });
});

describe('host leave', () => {
  test('a host leaving an assembling Room closes it, even during prep', () => {
    const room = {
      ...state(),
      status: 'assembling' as const,
      prepStartedAt: edges.now,
      prepRemainingMs: 60_000,
    };
    const left = executeRoomCommand(
      room,
      'host',
      { type: 'leave-seat', commandId: 'leave', expectedVersion: room.version },
      consent,
      edges,
    );
    assert({
      given: 'the host leaving their seat while the Room assembles',
      should: 'close the Room and free every member',
      actual: left.ok && [left.mutation.state.status, left.mutation.members],
      expected: ['abandoned', []],
    });
  });

  test('a seated guest leaving frees only their own membership', () => {
    const room = { ...state(), status: 'assembling' as const };
    const left = executeRoomCommand(
      room,
      'other',
      { type: 'leave-seat', commandId: 'leave', expectedVersion: room.version },
      consent,
      edges,
    );
    assert({
      given: 'a guest leaving their seat',
      should: 'keep the Room assembling with the host still a member',
      actual: left.ok && [left.mutation.state.status, left.mutation.members],
      expected: ['assembling', ['host']],
    });
  });
});

describe('idle expiry', () => {
  const lastCommandAt = '2026-10-09T00:00:00.000Z';
  test('a Room idle past the timeout is closed', () => {
    const room = state();
    const expired = expireIdleRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:10:00.000Z',
      idleTimeoutMs: 600_000,
    });
    assert({
      given: 'an open Room whose last command is exactly the timeout old',
      should: 'abandon it as a new change, keeping its version',
      actual: expired && [
        expired.mutation.state.status,
        expired.mutation.state.changeVersion,
        expired.mutation.state.version,
        expired.mutation.members,
      ],
      expected: ['abandoned', room.changeVersion + 1, room.version, []],
    });
  });

  test('activity and running prep keep a Room open', () => {
    const now = '2026-10-09T00:10:00.000Z';
    const before = JSON.stringify(state());
    assert({
      given:
        'a Room active within the timeout, a Room still in its pre-round prep, and a closed or launched Room',
      should: 'expire none of them and leave each state unchanged',
      actual: [
        expireIdleRoom(state(), {
          lastCommandAt,
          now: '2026-10-09T00:09:59.999Z',
          idleTimeoutMs: 600_000,
        }),
        expireIdleRoom(
          {
            ...state(),
            prepStartedAt: '2026-10-09T00:05:00.000Z',
            prepRemainingMs: 300_000,
          },
          { lastCommandAt, now: '2026-10-09T00:14:59.999Z', idleTimeoutMs: 600_000 },
        ),
        expireIdleRoom(
          { ...state(), status: 'abandoned' },
          { lastCommandAt, now, idleTimeoutMs: 600_000 },
        ),
        expireIdleRoom(withRound('active'), {
          lastCommandAt,
          now,
          idleTimeoutMs: 600_000,
        }),
        JSON.stringify(state()) === before,
      ],
      expected: [null, null, null, null, true],
    });
  });

  test('prep idles from its end, not its start', () => {
    const room = {
      ...state(),
      prepStartedAt: '2026-10-09T00:05:00.000Z',
      prepRemainingMs: 300_000,
    };
    const expired = expireIdleRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:20:00.000Z',
      idleTimeoutMs: 600_000,
    });
    assert({
      given: 'a Room whose prep ended a full timeout ago',
      should: 'expire it',
      actual: expired?.mutation.state.status,
      expected: 'abandoned',
    });
  });
});

describe('my active Room', () => {
  const facts = {
    room: { id: 'r'.repeat(24), title: 'Room', hostActorId: 'host' },
    roundRef: null,
    seatRole: null,
  };
  test('the read names the phase, the page and the member role', () => {
    assert({
      given: 'the host of an assembling Room, a ready debater and a live judge',
      should: 'project each active room read',
      actual: [
        projectActiveRoom({ ...facts, status: 'assembling' }, 'host'),
        projectActiveRoom(
          { ...facts, status: 'ready', seatRole: 'negative' },
          'other',
        ),
        projectActiveRoom(
          {
            ...facts,
            status: 'started',
            roundRef: { id: 'o'.repeat(24), status: 'active' },
            seatRole: 'judge',
          },
          'other',
        ),
      ],
      expected: [
        {
          version: 1,
          id: facts.room.id,
          title: 'Room',
          phase: 'assembling',
          role: 'host',
          href: `/rooms/${facts.room.id}`,
        },
        {
          version: 1,
          id: facts.room.id,
          title: 'Room',
          phase: 'ready',
          role: 'debater',
          href: `/rooms/${facts.room.id}`,
        },
        {
          version: 1,
          id: facts.room.id,
          title: 'Room',
          phase: 'live',
          role: 'judge',
          href: `/rounds/${'o'.repeat(24)}/room`,
        },
      ],
    });
  });

  test('a Room that no longer holds the user is no active room', () => {
    assert({
      given: 'a closed Room, a finished Round and an unseated non-host',
      should: 'read no active room',
      actual: [
        projectActiveRoom({ ...facts, status: 'abandoned' }, 'host'),
        projectActiveRoom(
          {
            ...facts,
            status: 'started',
            roundRef: { id: 'o'.repeat(24), status: 'completed' },
          },
          'host',
        ),
        projectActiveRoom({ ...facts, status: 'assembling' }, 'other'),
      ],
      expected: [null, null, null],
    });
  });
});

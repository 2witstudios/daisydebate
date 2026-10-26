import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { activeRoomMembers, projectActiveRoom } from './room-membership';
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

describe('Launch', () => {
  test('starting the Round keeps every member held while it is live', () => {
    const room = state();
    const started = executeRoomCommand(
      room,
      'host',
      {
        type: 'start-round',
        commandId: 'start',
        expectedVersion: room.version,
      },
      consent,
      edges,
    );
    assert({
      given: 'a ready Room whose host launches its Round',
      should: 'freeze it started with the host and guest still members',
      actual: started.ok && [
        started.mutation.state.status,
        started.mutation.freeze,
        started.mutation.members,
      ],
      expected: ['started', true, ['host', 'other']],
    });
  });
});

describe('leaving a seat', () => {
  test('a host leaving their seat stays the host of an open Room', () => {
    const room = { ...state(), status: 'assembling' as const };
    const left = executeRoomCommand(
      room,
      'host',
      { type: 'leave-seat', commandId: 'leave', expectedVersion: room.version },
      consent,
      edges,
    );
    assert({
      given: 'the host leaving their seat while the Room assembles',
      should:
        'unseat them only, keeping the Room open and the seatless host a member',
      actual: left.ok && [
        left.mutation.state.status,
        left.mutation.state.participants.map((p) => p.actorId),
        left.mutation.members,
      ],
      expected: ['assembling', ['other'], ['host', 'other']],
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

  test('only the explicit Close closes the Room', () => {
    const room = state();
    const closed = executeRoomCommand(
      room,
      'host',
      { type: 'close', commandId: 'close', expectedVersion: room.version },
      consent,
      edges,
    );
    assert({
      given: 'the host closing an open Room',
      should: 'abandon it and free every member',
      actual: closed.ok && [
        closed.mutation.state.status,
        closed.mutation.members,
      ],
      expected: ['abandoned', []],
    });
  });
});

describe('my active Room', () => {
  const facts = {
    room: { id: 'r'.repeat(24), title: 'Room', hostActorId: 'host' },
    roundRef: null,
    seatRole: null,
    debateEnded: false,
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

  test('a seatless host still hosts a live Round', () => {
    const roundId = 'o'.repeat(24);
    assert({
      given: 'a host who holds no seat after Launch',
      should: 'stay a member and read the live Room as its host',
      actual: [
        activeRoomMembers({
          ...state(),
          status: 'started',
          roundRef: { id: roundId, status: 'active' },
          participants: state().participants.filter(
            (p) => p.actorId !== 'host',
          ),
        }),
        projectActiveRoom(
          {
            ...facts,
            status: 'started',
            roundRef: { id: roundId, status: 'active' },
          },
          'host',
        )?.role,
      ],
      expected: [['host', 'other'], 'host'],
    });
  });

  test('a Room that no longer holds the user is no active room', () => {
    assert({
      given:
        'a closed Room, a finished Round, a Round awaiting ballots and an unseated non-host',
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
        projectActiveRoom(
          {
            ...facts,
            status: 'started',
            roundRef: { id: 'o'.repeat(24), status: 'active' },
            debateEnded: true,
          },
          'host',
        ),
        projectActiveRoom({ ...facts, status: 'assembling' }, 'other'),
      ],
      expected: [null, null, null, null],
    });
  });
});

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isRoomRoundLink, type RoomAssemblyState } from '@daisy/protocol';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { activeRoomMembers, projectActiveRoom } from './room-membership';
import { consent, edges, started, state } from './room-assembly.test-support';

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
  status: 'opening' | 'active' | 'completed' | 'abandoned',
): RoomAssemblyState => started(state(), status);

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
        activeRoomMembers(withRound('opening')),
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
        activeRoomMembers({ ...state(), status: 'closed' }),
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
    const launched = executeRoomCommand(
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
      should:
        'freeze it started, naming the Round it launches, with the host and guest still members',
      actual: launched.ok && [
        launched.mutation.state.status,
        launched.mutation.state.roundRef,
        launched.mutation.freeze,
        launched.mutation.members,
      ],
      expected: [
        'started',
        { id: 'new-round', status: 'active' },
        true,
        ['host', 'other'],
      ],
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
      should: 'close it and free every member',
      actual: closed.ok && [
        closed.mutation.state.status,
        closed.mutation.members,
      ],
      expected: ['closed', []],
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
          seated: false,
          href: `/rooms/${facts.room.id}`,
        },
        {
          version: 1,
          id: facts.room.id,
          title: 'Room',
          phase: 'ready',
          role: 'debater',
          seated: true,
          href: `/rooms/${facts.room.id}`,
        },
        {
          version: 1,
          id: facts.room.id,
          title: 'Room',
          phase: 'live',
          role: 'judge',
          seated: true,
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
        projectActiveRoom({ ...facts, status: 'closed' }, 'host'),
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

describe('a started Room and its Round', () => {
  const start = (room: RoomAssemblyState) =>
    executeRoomCommand(
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
  const prepFirst = (): RoomAssemblyState => {
    const room = state();
    return {
      ...room,
      executionPlan: {
        ...room.executionPlan,
        preRoundPrep: { enabled: true, durationMs: 60_000 },
      },
    };
  };

  test('Start round names the Round it launches, in the status it launches in', () => {
    const [plain, prepared] = [start(state()), start(prepFirst())];
    assert({
      given:
        'a Start round with nothing to run first, and one with pre-round prep',
      should:
        'name an active Round, and an opening one, under the id the adapter inserts it with',
      actual: [plain, prepared].map(
        (outcome) => outcome.ok && outcome.mutation.state.roundRef,
      ),
      expected: [
        { id: 'new-round', status: 'active' },
        { id: 'new-round', status: 'opening' },
      ],
    });
  });

  test('the member read and the membership rule agree on every Room', () => {
    const facts = (room: RoomAssemblyState, debateEnded = false) => ({
      ...room,
      room: { id: 'r'.repeat(24), title: room.title, hostActorId: 'host' },
      seatRole: null,
      debateEnded,
    });
    const rooms = [
      state(),
      { ...state(), status: 'assembling' as const },
      started(state(), 'opening'),
      started(state(), 'active'),
      started(state(), 'completed'),
      started(state(), 'abandoned'),
      { ...state(), status: 'closed' as const },
      { ...started(state(), 'completed'), status: 'closed' as const },
    ];
    assert({
      given: 'every Room status with every Round it can name, read by its host',
      should:
        'hold its members exactly when the host reads an active Room, a live one at its Round',
      actual: rooms.map((room) => [
        activeRoomMembers(room).length > 0,
        projectActiveRoom(facts(room), 'host')?.href ?? null,
      ]),
      expected: [
        [true, `/rooms/${'r'.repeat(24)}`],
        [true, `/rooms/${'r'.repeat(24)}`],
        [true, '/rounds/round/room'],
        [true, '/rounds/round/room'],
        [false, null],
        [false, null],
        [false, null],
        [false, null],
      ],
    });
    assert({
      given: 'a started Room whose Round is active and its last speech ended',
      should: 'hold no one in either',
      actual: [
        activeRoomMembers({ ...started(state()), debateEnded: true }),
        projectActiveRoom(facts(started(state()), true), 'host'),
      ],
      expected: [[], null],
    });
  });
});

describe('a viewer reads a Room and its Round as one state', () => {
  test('only its own people learn a started Room and its Round', () => {
    const rooms = [
      state(),
      started(state(), 'opening'),
      started(state(), 'completed'),
      { ...state(), status: 'closed' as const },
      { ...started(state()), status: 'closed' as const },
    ];
    const read = (room: RoomAssemblyState, actorId: string) => {
      const view = projectRoom(room, actorId, consent, edges.now);
      return [
        `${view.status}/${view.roundRef?.status ?? '-'}`,
        isRoomRoundLink(view),
      ];
    };
    assert({
      given:
        'an open, a started and a closed Room, read by its host, a seated member and an outsider',
      should:
        'give its own people the Round a started or closed Room names, an outsider a closed Room with none, and always a pair the contract holds',
      actual: rooms.map((room) =>
        ['host', 'other', 'outsider'].map((actorId) => read(room, actorId)),
      ),
      expected: [
        [
          ['ready/-', true],
          ['ready/-', true],
          ['ready/-', true],
        ],
        [
          ['started/opening', true],
          ['started/opening', true],
          ['closed/-', true],
        ],
        [
          ['started/completed', true],
          ['started/completed', true],
          ['closed/-', true],
        ],
        [
          ['closed/-', true],
          ['closed/-', true],
          ['closed/-', true],
        ],
        [
          ['closed/active', true],
          ['closed/active', true],
          ['closed/-', true],
        ],
      ],
    });
  });
});

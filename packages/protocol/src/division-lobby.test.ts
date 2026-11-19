import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  canWatchLive,
  isYouthRound,
  lobbyOf,
  roomLobbyAtCreation,
  seatAllowed,
} from './division-lobby';
import type { SeatRef } from './seats';

setupRitewayBun();

test('lobbyOf', () => {
  assert({
    given: 'an adult, a minor and a member with no age record',
    should: 'land the adult in Open, the minor in Youth, no record in Open',
    actual: [
      lobbyOf({ division: 'open' }),
      lobbyOf({ division: 'youth' }),
      lobbyOf({ division: null }),
    ],
    expected: ['open', 'youth', 'open'],
  });
});

test('roomLobbyAtCreation', () => {
  const adult = { division: 'open', clubStaff: false } as const;
  const minor = { division: 'youth', clubStaff: false } as const;
  const staff = { division: 'open', clubStaff: true } as const;
  assert({
    given: 'a member creating with no choice or their own lobby chosen',
    should: 'open the Room in their own lobby',
    actual: [
      roomLobbyAtCreation(adult, null),
      roomLobbyAtCreation(minor, null),
      roomLobbyAtCreation(minor, 'youth'),
      roomLobbyAtCreation({ division: null, clubStaff: false }, null),
    ],
    expected: [
      { kind: 'division', division: 'open' },
      { kind: 'division', division: 'youth' },
      { kind: 'division', division: 'youth' },
      { kind: 'division', division: 'open' },
    ],
  });
  assert({
    given: 'a member choosing the other lobby',
    should: 'refuse it',
    actual: [
      roomLobbyAtCreation(adult, 'youth'),
      roomLobbyAtCreation(minor, 'open'),
    ],
    expected: [
      { kind: 'refused', refusal: 'other-division' },
      { kind: 'refused', refusal: 'other-division' },
    ],
  });
  assert({
    given: 'club staff choosing either lobby',
    should: 'open a Youth Room for their students, or one in their own lobby',
    actual: [
      roomLobbyAtCreation(staff, 'youth'),
      roomLobbyAtCreation(staff, 'open'),
    ],
    expected: [
      { kind: 'division', division: 'youth' },
      { kind: 'division', division: 'open' },
    ],
  });
});

test('seatAllowed', () => {
  const aff: SeatRef = { kind: 'side', side: 'affirmative', slot: 0 };
  const judge: SeatRef = { kind: 'judge', slot: 0 };
  const adult = { kind: 'human', division: 'open' } as const;
  const minor = { kind: 'human', division: 'youth' } as const;
  const unknown = { kind: 'human', division: null } as const;
  const bot = { kind: 'bot', division: null } as const;
  const room = (
    division: 'open' | 'youth',
    competitionType: 'ranked' | 'casual',
  ) => ({ division, competitionType });
  assert({
    given: 'a debater seat in a Room of the member’s own lobby',
    should: 'allow it, ranked and casual',
    actual: [
      seatAllowed(adult, room('open', 'ranked'), aff),
      seatAllowed(minor, room('youth', 'ranked'), aff),
      seatAllowed(minor, room('youth', 'casual'), aff),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'a debater seat in the other lobby’s Room',
    should: 'refuse it, ranked and casual',
    actual: [
      seatAllowed(minor, room('open', 'ranked'), aff),
      seatAllowed(minor, room('open', 'casual'), aff),
      seatAllowed(adult, room('youth', 'ranked'), aff),
      seatAllowed(adult, room('youth', 'casual'), aff),
    ],
    expected: [false, false, false, false],
  });
  assert({
    given: 'a judge seat in either lobby',
    should: 'allow anyone, minors judging Open included',
    actual: [
      seatAllowed(minor, room('open', 'ranked'), judge),
      seatAllowed(adult, room('youth', 'ranked'), judge),
      seatAllowed(unknown, room('youth', 'ranked'), judge),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'a member with no age record',
    should: 'debate only in an Open casual Room',
    actual: [
      seatAllowed(unknown, room('open', 'casual'), aff),
      seatAllowed(unknown, room('open', 'ranked'), aff),
      seatAllowed(unknown, room('youth', 'casual'), aff),
    ],
    expected: [true, false, false],
  });
  assert({
    given: 'a bot',
    should: 'debate in a casual Room of either lobby, never a ranked one',
    actual: [
      seatAllowed(bot, room('youth', 'casual'), aff),
      seatAllowed(bot, room('open', 'casual'), aff),
      seatAllowed(bot, room('open', 'ranked'), aff),
    ],
    expected: [true, true, false],
  });
});

test('canWatchLive', () => {
  assert({
    given: 'an Open Round',
    should: 'let any member watch it live',
    actual: canWatchLive({ standing: 'none' }, { division: 'open' }),
    expected: true,
  });
  assert({
    given: 'a Youth Round',
    should: 'let only its seats and seatless host watch it live',
    actual: [
      canWatchLive({ standing: 'seat' }, { division: 'youth' }),
      canWatchLive({ standing: 'seatless-host' }, { division: 'youth' }),
      canWatchLive({ standing: 'none' }, { division: 'youth' }),
    ],
    expected: [true, true, false],
  });
});

test('isYouthRound', () => {
  const casual = { ladderDivision: null } as const;
  assert({
    given: 'a casual Round in a Youth Room and one in an Open Room',
    should: 'be a Youth Round only in the Youth Room',
    actual: [
      isYouthRound(casual, { division: 'youth' }),
      isYouthRound(casual, { division: 'open' }),
    ],
    expected: [true, false],
  });
  assert({
    given: 'a ranked Round, whose ladder is its Room division',
    should: 'follow the Room division',
    actual: [
      isYouthRound({ ladderDivision: 'youth' }, { division: 'youth' }),
      isYouthRound({ ladderDivision: 'open' }, { division: 'open' }),
    ],
    expected: [true, false],
  });
  assert({
    given: 'a Youth ladder in an Open Room, which ADR 0156 never makes',
    should: 'still be Youth: the rule fails closed',
    actual: isYouthRound({ ladderDivision: 'youth' }, { division: 'open' }),
    expected: true,
  });
  assert({
    given: 'a Round with no Room',
    should: 'fall back to its frozen ladder division',
    actual: [
      isYouthRound({ ladderDivision: 'youth' }, null),
      isYouthRound({ ladderDivision: 'open' }, null),
      isYouthRound(casual, null),
    ],
    expected: [true, false, false],
  });
});

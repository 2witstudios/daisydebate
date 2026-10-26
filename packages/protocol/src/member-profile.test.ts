import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { matchHistoryQuerySchema, memberProfileSchema } from './member-profile';

setupRitewayBun();

const entry = {
  roundId: 'r'.repeat(24),
  completedAt: '2026-10-26T12:00:00.000Z',
  resolution: 'This house would ban homework',
  side: 'affirmative',
  opponents: [{ kind: 'bot', label: 'Socrates' }],
  result: 'win',
  forfeit: false,
  judges: 'ai',
  visibility: 'public',
} as const;
const profile = {
  version: 1,
  username: 'debater-a',
  memberSince: '2026-09-01T00:00:00.000Z',
  me: false,
  record: { wins: 1, losses: 0, draws: 0 },
  history: [entry],
  nextBefore: null,
} as const;

describe('memberProfileSchema', () => {
  test('a profile with one Round', () => {
    assert({
      given: 'a well-formed profile',
      should: 'parse',
      actual: memberProfileSchema.safeParse(profile).success,
      expected: true,
    });
  });

  test('refused shapes', () => {
    assert({
      given:
        'a rating field, a negative count, an unknown result and a judge seat as the side',
      should: 'refuse each',
      actual: [
        { ...profile, rating: 1500 },
        { ...profile, record: { wins: -1, losses: 0, draws: 0 } },
        { ...profile, history: [{ ...entry, result: 'forfeit' }] },
        { ...profile, history: [{ ...entry, side: 'judge' }] },
      ].map((input) => memberProfileSchema.safeParse(input).success),
      expected: [false, false, false, false],
    });
  });
});

describe('matchHistoryQuerySchema', () => {
  test('the before cursor', () => {
    assert({
      given: 'no cursor, a Round id, and a malformed cursor',
      should: 'accept the first two only',
      actual: [{}, { before: 'r'.repeat(24) }, { before: '1; drop' }].map(
        (input) => matchHistoryQuerySchema.safeParse(input).success,
      ),
      expected: [true, true, false],
    });
  });
});

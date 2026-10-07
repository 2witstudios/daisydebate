import { describe, test } from 'riteway/bun';
import { assert } from 'riteway/bun';
import { setupRitewayBun } from 'riteway/bun';
import type { RoundHydration } from '@daisy/db';
import { personSideOf, participantIdOf } from './context';

setupRitewayBun();

/**
 * Only `participants` matters here, which is the point: the function must not
 * depend on anything else about the round.
 */
const hydrationWith = (
  participants: RoundHydration['participants'],
): RoundHydration => ({ participants }) as unknown as RoundHydration;

const seat = (actorId: string, role: 'affirmative' | 'negative' | 'judge') =>
  ({
    id: `part-${actorId}`,
    actorId,
    role,
    slot: 0,
  }) as RoundHydration['participants'][number];

describe("the person's side comes from their own seat", () => {
  // A room's seats are authoritative rows and participant reads carry no
  // ordering guarantee, so "the first participant who is not the judge" is
  // whichever row the database returned. With a bot in the room the two
  // debaters are symmetric, so the bot's seat could answer for the person and
  // silently swap their side.
  test('the negative debater reads negative even when the bot is seated first', () => {
    const round = hydrationWith([
      seat('bot-1', 'affirmative'),
      seat('person-1', 'negative'),
      seat('judge-1', 'judge'),
    ]);
    assert({
      given: 'the bot seated first and the person on the negative side',
      should: 'resolve the requesting actor to negative',
      actual: personSideOf(round, 'person-1'),
      expected: 'negative',
    });
  });

  test('the affirmative debater reads affirmative even when the bot is seated first', () => {
    const round = hydrationWith([
      seat('bot-1', 'negative'),
      seat('person-1', 'affirmative'),
      seat('judge-1', 'judge'),
    ]);
    assert({
      given: 'the bot seated first and the person on the affirmative side',
      should: 'resolve the requesting actor to affirmative',
      actual: personSideOf(round, 'person-1'),
      expected: 'affirmative',
    });
  });

  test('the same round reads differently for the bot than for the person', () => {
    const round = hydrationWith([
      seat('bot-1', 'affirmative'),
      seat('person-1', 'negative'),
      seat('judge-1', 'judge'),
    ]);
    assert({
      given: 'one room with the bot on affirmative and the person on negative',
      should: 'give each actor their own side, not one answer for both',
      actual: {
        person: personSideOf(round, 'person-1'),
        bot: personSideOf(round, 'bot-1'),
      },
      expected: { person: 'negative', bot: 'affirmative' },
    });
  });

  test('participant id resolution agrees with the side resolution', () => {
    const round = hydrationWith([
      seat('bot-1', 'affirmative'),
      seat('person-1', 'negative'),
      seat('judge-1', 'judge'),
    ]);
    assert({
      given: 'the negative debater in a bot-first room',
      should: 'resolve to the seat that carries the negative role',
      actual: round.participants.find(
        (candidate) => candidate.id === participantIdOf(round, 'person-1'),
      )?.role,
      expected: 'negative',
    });
  });

  // The AI judge ballots and reads the view without holding a debater seat.
  test('a judge, who holds no debater seat, reads affirmative rather than throwing', () => {
    const round = hydrationWith([
      seat('bot-1', 'affirmative'),
      seat('person-1', 'negative'),
      seat('judge-1', 'judge'),
    ]);
    assert({
      given: 'a judge asking which side the person took',
      should: 'read affirmative, the default for a seat that is not a debater',
      actual: personSideOf(round, 'judge-1'),
      expected: 'affirmative',
    });
  });
});

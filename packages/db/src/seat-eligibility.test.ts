import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  eligibleCompetitorIds,
  fencedActorIds,
  seatEligibility,
} from './seat-eligibility';

setupRitewayBun();

const botSide = { actorId: 'bot', role: 'affirmative' };
const account = (actorId: string, member: boolean, erased = false) => ({
  actorId,
  member,
  erased,
});

test('bot seats follow the canonical profile, never an account', () => {
  assert({
    given: 'bots with and without a canonical profile and a member account',
    should: 'take eligibility from the profile alone',
    actual: [
      seatEligibility(
        { kind: 'bot', eligible: true, seatRole: 'debater' },
        [],
        botSide,
      ),
      seatEligibility(
        { kind: 'bot', eligible: false, seatRole: null },
        [account('bot', true)],
        botSide,
      ),
    ],
    expected: [
      { kind: 'bot', eligible: true },
      { kind: 'bot', eligible: false },
    ],
  });
});

test('an AI actor is eligible only in its own kind of seat (ISSUE-750)', () => {
  const judgeSeat = { actorId: 'bot', role: 'judge' };
  assert({
    given:
      'a bot debater in the judge seat, the AI judge on a side, and each in its own seat',
    should: 'refuse the mismatched seatings and admit the matching ones',
    actual: [
      seatEligibility(
        { kind: 'bot', eligible: true, seatRole: 'debater' },
        [],
        judgeSeat,
      ).eligible,
      seatEligibility(
        { kind: 'bot', eligible: true, seatRole: 'judge' },
        [],
        botSide,
      ).eligible,
      seatEligibility(
        { kind: 'bot', eligible: true, seatRole: 'judge' },
        [],
        judgeSeat,
      ).eligible,
      seatEligibility(
        { kind: 'bot', eligible: true, seatRole: 'debater' },
        [],
        botSide,
      ).eligible,
    ],
    expected: [false, false, true, true],
  });
});

test('human seats need their own live member account', () => {
  const human = { kind: 'human', eligible: true, seatRole: null } as const;
  const seat = { actorId: 'a', role: 'affirmative' };
  assert({
    given:
      'a member, an erased member, a non-member, a missing account and another actor’s account',
    should: 'admit only the live member account for this actor',
    actual: [
      seatEligibility(human, [account('a', true)], seat),
      seatEligibility(human, [account('a', true, true)], seat),
      seatEligibility(human, [account('a', false)], seat),
      seatEligibility(human, [null], seat),
      seatEligibility(human, [account('b', true)], seat),
    ].map(({ eligible }) => eligible),
    expected: [true, false, false, false, false],
  });
});

test('an actor of unknown kind is never eligible, even with a member account', () => {
  assert({
    given: 'no canonical actor fact but a live member account',
    should: 'report an ineligible human seat so no authority attaches',
    actual: seatEligibility(null, [account('a', true)], {
      actorId: 'a',
      role: 'affirmative',
    }),
    expected: { kind: 'human', eligible: false },
  });
});

test('fenced actors are distinct, seats first, without absent extras', () => {
  assert({
    given:
      'repeated seat actors, a host also seated, and absent optional actors',
    should: 'list each actor once in first-seen order',
    actual: fencedActorIds(
      [{ actorId: 'a' }, { actorId: 'b' }, { actorId: 'a' }],
      'b',
      null,
      undefined,
      '',
      'host',
    ),
    expected: ['a', 'b', 'host'],
  });
});

test('only eligible debating seats are attendance competitors', () => {
  assert({
    given: 'eligible and ineligible debaters and an eligible judge',
    should: 'keep only the eligible debaters in seat order',
    actual: eligibleCompetitorIds([
      { id: 'aff', role: 'affirmative', eligible: true },
      { id: 'neg', role: 'negative', eligible: false },
      { id: 'judge', role: 'judge', eligible: true },
      { id: 'neg2', role: 'negative', eligible: true },
    ]),
    expected: ['aff', 'neg2'],
  });
});

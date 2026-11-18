import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noLadderReason } from '../play/ladder-division-words';
import {
  acrossLadders,
  challengeSummary,
  mayAcceptOffer,
  offersRanked,
  rankedChallengeLine,
  rankedChallengeOf,
  unacceptableOfferReason,
} from './challenge-ladder';

setupRitewayBun();

describe('rankedChallengeOf', () => {
  test('ranked needs both members on one division', () => {
    assert({
      given:
        'youth to youth, youth to an unknown ladder, youth to open, and a member with no ladder',
      should:
        'offer ranked on Youth twice, casual across ladders, and no ranked without a ladder',
      actual: [
        rankedChallengeOf('youth', 'youth'),
        rankedChallengeOf('youth', null),
        rankedChallengeOf('youth', 'open'),
        rankedChallengeOf(null, 'open'),
      ].map((challenge) => [challenge.kind, offersRanked(challenge)]),
      expected: [
        ['ranked', true],
        ['ranked', true],
        ['across-ladders', false],
        ['no-ladder', false],
      ],
    });
  });
});

describe('rankedChallengeLine', () => {
  test('the words YChallenge shows', () => {
    assert({
      given: 'each ranked state toward @devon_r',
      should: 'name the ladder, the reason it is casual, or the missing age',
      actual: [
        rankedChallengeLine(rankedChallengeOf('youth', 'youth'), 'devon_r'),
        rankedChallengeLine(rankedChallengeOf('youth', 'open'), 'devon_r'),
        rankedChallengeLine(rankedChallengeOf(null, null), 'devon_r'),
      ],
      expected: [
        'Ranked on Youth – Freestyle',
        'Ranked needs you both on one ladder. You play Youth – Freestyle and @devon_r plays Open – Freestyle, so this challenge is casual.',
        noLadderReason,
      ],
    });
  });
});

describe('challengeSummary', () => {
  test('a ranked offer names its ladder; a casual one marks mixed ladders', () => {
    assert({
      given:
        'a ranked Youth offer, a casual offer across ladders, and a casual one otherwise',
      should: 'read as the challenge cards show them',
      actual: [
        challengeSummary(
          { mode: 'ranked', format: 'freestyle', division: 'youth' },
          false,
        ),
        challengeSummary(
          { mode: 'casual', format: 'freestyle', division: null },
          true,
        ),
        challengeSummary(
          { mode: 'casual', format: 'freestyle', division: null },
          false,
        ),
      ],
      expected: [
        'Youth – Freestyle · Ranked',
        'Freestyle · Casual · mixed ladders',
        'Freestyle · Casual',
      ],
    });
  });
});

describe('accepting an offer', () => {
  test('ranked only on the member’s own ladder', () => {
    assert({
      given:
        'a casual offer, a ranked Youth offer to a youth member, to an open member, and to a member with no ladder',
      should: 'allow the first two and refuse the rest, saying why',
      actual: [
        mayAcceptOffer({ mode: 'casual', division: null }, null),
        mayAcceptOffer({ mode: 'ranked', division: 'youth' }, 'youth'),
        mayAcceptOffer({ mode: 'ranked', division: 'youth' }, 'open'),
        mayAcceptOffer({ mode: 'ranked', division: 'youth' }, null),
        unacceptableOfferReason({ division: 'youth' }, 'open'),
        unacceptableOfferReason({ division: 'youth' }, null),
      ],
      expected: [
        true,
        true,
        false,
        false,
        'This challenge is ranked on Youth – Freestyle, and you play Open – Freestyle. Decline it, or ask for a casual one.',
        noLadderReason,
      ],
    });
  });
});

describe('acrossLadders', () => {
  test('only when both are known and differ', () => {
    assert({
      given: 'open and youth, youth twice, and one unknown',
      should: 'be true only for the first',
      actual: [
        acrossLadders('open', 'youth'),
        acrossLadders('youth', 'youth'),
        acrossLadders('youth', null),
      ],
      expected: [true, false, false],
    });
  });
});

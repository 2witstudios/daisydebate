import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { overviewFacts, ruleCards } from './facts';
import { tournament } from './tournament.test-support';

setupRitewayBun();

describe('overviewFacts', () => {
  test('elimination rows', () => {
    assert({
      given: '16 single-elimination places with standard rules',
      should: 'count rounds, note byes and say unrated',
      actual: overviewFacts(tournament()).map(
        ([label, value]) => `${label}: ${value}`,
      ),
      expected: [
        'Structure: Single elimination, 4 rounds',
        'Rules: Standard rules',
        'Places: 16 (top seeds get byes if fewer enter)',
        'Rating: Unrated tournament',
        'Judging: One judge, assigned by Daisy',
        'Who can enter: Any debater with a username and a rating',
        'Organizer: Daisy Debate',
      ],
    });
  });

  test('round robin and a rating band', () => {
    const facts = Object.fromEntries(
      overviewFacts(
        tournament({
          structure: 'round-robin',
          places: 8,
          band: { min: 1000, max: 1400 },
        }),
      ),
    );
    assert({
      given: 'a round robin of 8 limited to 1000 to 1400',
      should: 'show 7 rounds, plain places and the band',
      actual: [facts['Structure'], facts['Places'], facts['Who can enter']],
      expected: ['Round robin, 7 rounds', '8', 'Debaters rated 1000 to 1400'],
    });
  });
});

describe('ruleCards', () => {
  test('standard and custom rules differ only in the first card', () => {
    const standard = ruleCards(tournament());
    const custom = ruleCards(tournament({ rules: 'custom' }));
    assert({
      given: 'standard and custom rules',
      should: 'keep five cards, changing only the rules card',
      actual: [
        standard.map((card) => card.title),
        custom[0]?.title,
        JSON.stringify(standard.slice(1)) === JSON.stringify(custom.slice(1)),
      ],
      expected: [
        [
          'Standard rules',
          'Judges are assigned by Daisy',
          'Check-in and forfeits',
          'Results and corrections',
          'Unrated',
        ],
        'Custom rules',
        true,
      ],
    });
  });
});

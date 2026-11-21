import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AgeBand } from '../ladder';
import {
  defaultStandingLobby,
  mayDebate,
  type LobbyAgeRule,
} from './eligibility';

setupRitewayBun();

test('mayDebate', () => {
  const cases: readonly [
    LobbyAgeRule,
    AgeBand | null,
    boolean,
    boolean,
    boolean,
  ][] = [
    ['adults', 'adult', false, true, true],
    ['adults', '16-17', false, false, false],
    ['adults', '13-15', true, true, true],
    ['adults', 'under-13', true, false, false],
    ['under-18', 'adult', true, false, false],
    ['under-18', 'under-13', false, false, false],
    ['under-18', '16-17', false, true, true],
    ['under-18', null, false, false, false],
    ['adults', null, false, false, true],
    ['anyone', 'adult', false, true, true],
    ['anyone', '13-15', false, true, true],
    ['anyone', null, false, false, true],
  ];

  for (const [ageRule, ageBand, guardianAllowed, ranked, casual] of cases) {
    assert({
      given: `a member in the ${ageBand ?? 'unknown'} age band, guardian permission ${guardianAllowed}, and an ${ageRule} lobby`,
      should: 'apply the age rule to ranked and casual debating',
      actual: (['ranked', 'casual'] as const).map((competitionType) =>
        mayDebate(
          { ageBand, guardianLobbyIds: guardianAllowed ? ['open'] : [] },
          { lobbyId: 'open', ageRule, competitionType },
        ),
      ),
      expected: [ranked, casual],
    });
  }
});

test('an approval follows its lobby', () => {
  const child = { ageBand: '13-15', guardianLobbyIds: ['open'] } as const;
  const rules = { ageRule: 'adults', competitionType: 'ranked' } as const;
  assert({
    given: 'a 14-year-old with guardian permission for one adult lobby',
    should: 'admit the child only to the adult lobby their guardian allowed',
    actual: [
      mayDebate(child, { ...rules, lobbyId: 'open' }),
      mayDebate(child, { ...rules, lobbyId: 'another-open-lobby' }),
    ],
    expected: [true, false],
  });
});

test('the landing lobby fits the member even with a partial set of choices', () => {
  const youth = { id: 'youth', name: 'Youth', ageRule: 'under-18' } as const;
  const anyone = { id: 'all', name: 'All ages', ageRule: 'anyone' } as const;
  assert({
    given: 'an adult, a Youth lobby, and an optional all-ages lobby',
    should:
      'select all ages when available and otherwise leave the lobby unspecified',
    actual: [
      defaultStandingLobby([youth, anyone], 'adult'),
      defaultStandingLobby([youth], 'adult'),
    ],
    expected: [anyone, null],
  });
});

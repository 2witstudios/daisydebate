import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getDraft } from './get-draft';
import { sampleTournamentSource } from '../../ui/mock/tournament-source';

setupRitewayBun();

describe('getDraft', () => {
  test('the sample draft is Winter Open, listed, standard rules', () => {
    const draft = getDraft(sampleTournamentSource);
    assert({
      given: 'the sample draft',
      should: 'name Winter Open with the standard rules and a public listing',
      actual: [draft.name, draft.rules, draft.listed],
      expected: ['Winter Open', 'standard', true],
    });
  });
});

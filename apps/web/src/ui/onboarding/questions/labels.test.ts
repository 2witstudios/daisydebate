import { assert, setupRitewayBun, test } from 'riteway/bun';
import { catalogFormats } from '@daisy/db/catalog-formats';
import { leagueSuggestions } from './labels';

setupRitewayBun();

test('every league the format catalog carries is a suggestion', () => {
  assert({
    given: 'the leagues of every catalog format',
    should:
      'all be among the onboarding suggestions, so adding a format for a new league fails here until the list names it',
    actual: [
      ...new Set(catalogFormats.flatMap((format) => format.leagues)),
    ].filter((league) => !leagueSuggestions.includes(league)),
    expected: [],
  });
});

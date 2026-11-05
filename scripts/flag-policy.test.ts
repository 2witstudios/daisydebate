import { assert, setupRitewayBun, test } from 'riteway/bun';
import { flagPolicyProblems } from './flag-policy';
import { flagCatalogue } from '../apps/web/src/features/flags/catalogue';
import ledger from '../policy/flag-keys.json';

setupRitewayBun();
test('flag policy refuses catalogue and identity violations', () => {
  const entry = flagCatalogue[0];
  const registry = { ...ledger, version: 1 as const };
  const problems = (
    entries: Parameters<typeof flagPolicyProblems>[0],
    today = '2026-11-05',
  ) => flagPolicyProblems(entries, registry, registry, today);
  assert({
    given: 'valid, expired, reused, cyclic, over-cap and unowned catalogues',
    should: 'fail policy for every invalid case',
    actual: [
      problems(flagCatalogue),
      problems(flagCatalogue, '2026-12-05'),
      problems([{ ...entry, owner: 'someone-else' }]),
      problems([{ ...entry, dependencies: [entry.key] }]),
      problems(
        Array.from({ length: 33 }, (_, i) => ({ ...entry, key: `flag-${i}` })),
      ),
      problems([{ ...entry, owner: '' }]),
    ].map((found) => found.length > 0),
    expected: [false, true, true, true, true, true],
  });
  assert({
    given: 'a deleted permanent identity',
    should: 'refuse erasing key history',
    actual:
      flagPolicyProblems([], { version: 1, keys: [] }, registry, '2026-11-05')
        .length > 0,
    expected: true,
  });
});

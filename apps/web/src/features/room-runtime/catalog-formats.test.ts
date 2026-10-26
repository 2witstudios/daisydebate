import { catalogFormats } from '@daisy/db/catalog-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

describe('catalogFormats against the compiler', () => {
  test('every canonical preset', () => {
    assert({
      given: 'each catalog format and its canonical preset',
      should: 'compile to rules with no refusal',
      actual: catalogFormats
        .map((entry) => ({
          id: entry.id,
          outcome: resolveRoomConfiguration(entry.definition, entry.preset),
        }))
        .filter(({ outcome }) => !outcome.ok)
        .map(({ id }) => id),
      expected: [],
    });
  });
});

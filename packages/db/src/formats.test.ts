import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  formatRow,
  sampleFormat,
} from './index.test-support';

setupRitewayBun();

describe('database format reads', () => {
  test('returns the current definition revision of a format', async () => {
    const format = sampleFormat();
    const { database, queries } = createTestDatabase([[formatRow(format)]]);

    assert({
      given: 'a stored format',
      should: 'return its id, name, pinned version and definition by slug',
      actual: {
        record: await database.getFormat(format.id),
        bound: queries[0]?.params.includes('foundation'),
      },
      expected: {
        record: {
          id: 'foundation',
          name: 'Foundation (architectural proof)',
          version: 1,
          definition: format.definition,
        },
        bound: true,
      },
    });
  });

  test('returns null for an unknown format', async () => {
    const { database } = createTestDatabase([[]]);

    assert({
      given: 'a slug matching no format',
      should: 'resolve to null',
      actual: await database.getFormat('no-such-format'),
      expected: null,
    });
  });

  test('refuses a stored definition that no longer matches the protocol shape', async () => {
    const format = sampleFormat();
    const { database } = createTestDatabase([
      [formatRow({ ...format, definition: { version: 1 } })],
    ]);

    // The jsonb column hands the stored value back as it was written: the
    // database CHECK keeps only its outline, so a corrupt definition
    // surfaces at the reader that resolves rules, not at this read.
    const result = await database.getFormat(format.id);
    assert({
      given: 'a stored definition that fails the protocol schema',
      should: 'hand the stored value back, unresolved',
      actual: JSON.stringify(result?.definition),
      expected: JSON.stringify({ version: 1 }),
    });
  });
});

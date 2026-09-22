import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  formatRow,
  sampleFormat,
} from './index.test-support';

setupRitewayBun();

describe('database format reads', () => {
  test('returns the canonical rules and ranked eligibility of a format', async () => {
    const format = sampleFormat();
    const { database, queries } = createTestDatabase([[formatRow(format)]]);

    assert({
      given: 'a stored format',
      should: 'return its id, validated rules and ranked eligibility by slug',
      actual: {
        record: await database.getFormat(format.id),
        bound: queries[0]?.params.includes('foundation'),
      },
      expected: {
        record: {
          id: 'foundation',
          rules: format.rules,
          rankedEligible: false,
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

  test('refuses a stored rules value that no longer matches the protocol shape', async () => {
    const format = sampleFormat();
    const { database } = createTestDatabase([
      [formatRow({ ...format, rules: { version: 1, seats: {} } })],
    ]);

    await expect(database.getFormat(format.id)).rejects.toThrow(
      'Stored format rules are invalid',
    );
  });
});

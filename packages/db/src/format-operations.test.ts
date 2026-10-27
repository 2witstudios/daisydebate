import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';
import { foundationDefinition, oneOnOneRoomConfig } from './reference-formats';

setupRitewayBun();

// Select column order as `format-operations` declares it.
const formatRow = () => ['one-on-one', 'One-on-one', 1, foundationDefinition];

describe('formatOperations', () => {
  test('getFormat reads the current revision through its join', async () => {
    const { database, queries } = createTestDatabase([[formatRow()]]);
    const format = await database.getFormat('one-on-one');
    assert({
      given: 'the format and its current revision row',
      should: 'read the definition through the version join',
      actual: format,
      expected: {
        id: 'one-on-one',
        name: 'One-on-one',
        version: 1,
        definition: foundationDefinition,
      },
    });
    assert({
      given: 'the read',
      should: 'join revisions on the current version',
      actual: queries[0]?.query.includes('join'),
      expected: true,
    });
  });

  test('getFormat reports null when the format is absent', async () => {
    const { database } = createTestDatabase([[]]);
    const format = await database.getFormat('nope');
    assert({
      given: 'no such format',
      should: 'report null rather than refuse',
      actual: format,
      expected: null,
    });
  });

  test('getCurrentPreset reads the live preset for the format', async () => {
    const { database } = createTestDatabase([
      [['one-on-one', 1, 1, oneOnOneRoomConfig]],
    ]);
    const preset = await database.getCurrentPreset('one-on-one');
    assert({
      given: 'the live preset row',
      should: 'read it with its provenance',
      actual: preset,
      expected: {
        formatId: 'one-on-one',
        version: 1,
        formatVersion: 1,
        config: oneOnOneRoomConfig,
      },
    });
  });

  test('getCurrentPreset reports null when the format has none', async () => {
    const { database } = createTestDatabase([[]]);
    const preset = await database.getCurrentPreset('one-on-one');
    assert({
      given: 'a format with no approved preset',
      should: 'report null for resolveRoom to refuse on',
      actual: preset,
      expected: null,
    });
  });

  test('getFormatRevision reads a pinned historical revision', async () => {
    const { database } = createTestDatabase([[[foundationDefinition]]]);
    const definition = await database.getFormatRevision('one-on-one', 1);
    assert({
      given: 'the pinned revision row',
      should: 'return its definition',
      actual: definition,
      expected: foundationDefinition,
    });
  });

  test('getFormatRevision refuses a pinned version that no longer resolves', async () => {
    const { database } = createTestDatabase([[]]);
    await assertRejects({
      given: 'a revision the table does not hold',
      should: 'refuse with the missing-revision invariant',
      actual: () => database.getFormatRevision('one-on-one', 9),
      code: 'INVARIANT',
    });
  });

  test('getFormatSelectionFacts reads the tuple a selection names', async () => {
    const { database, queries } = createTestDatabase([
      [
        [
          'value',
          'Value',
          [],
          null,
          'standard',
          2,
          foundationDefinition,
          3,
          1,
          oneOnOneRoomConfig,
          false,
          new Date(0),
        ],
      ],
    ]);
    const facts = await database.getFormatSelectionFacts({
      formatId: 'value',
      formatVersion: 1,
      presetVersion: 3,
    });
    assert({
      given: 'a superseded preset of a standard whose pointer has moved on',
      should:
        'report the facts as stored, for the selection policy to judge, never substituting the current preset',
      actual: facts,
      expected: {
        format: {
          id: 'value',
          name: 'Value',
          leagues: [],
          catalogOwned: true,
          role: 'standard',
          currentVersion: 2,
        },
        definition: foundationDefinition,
        preset: {
          version: 3,
          formatVersion: 1,
          config: oneOnOneRoomConfig,
          rankedEligible: false,
          current: false,
        },
      },
    });
    assert({
      given: 'the read',
      should:
        'lock the format and preset rows for share, so publication serializes with selection',
      actual: /for share/i.test(queries[0]?.query ?? ''),
      expected: true,
    });
  });

  test('getFormatSelectionFacts reports null for a tuple that does not exist', async () => {
    const { database } = createTestDatabase([[]]);
    assert({
      given: 'no format, revision and preset matching the tuple',
      should: 'report null, which the policy refuses as unavailable',
      actual: await database.getFormatSelectionFacts({
        formatId: 'forged',
        formatVersion: 1,
        presetVersion: 1,
      }),
      expected: null,
    });
  });
});

import type { Database } from '@daisy/db';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomChoice } from './resolve-room';

setupRitewayBun();

type FormatReader = Pick<
  Database,
  'getFormat' | 'getCurrentPreset' | 'getFormatRevision'
>;

const reader = (overrides: Partial<FormatReader> = {}): FormatReader => ({
  getFormat: async () => ({
    id: 'one-on-one',
    name: 'One on one',
    version: 2,
    definition: oneOnOneDefinition,
  }),
  getCurrentPreset: async () => null,
  getFormatRevision: async () => oneOnOneDefinition,
  ...overrides,
});

describe('outer Room resolution', () => {
  test('ranked Room uses its sanctioned preset and pinned historical definition', async () => {
    const reads: string[] = [];
    const store = reader({
      getFormat: async () => {
        reads.push('current');
        return null;
      },
      getCurrentPreset: async () => {
        reads.push('preset');
        return {
          formatId: 'one-on-one',
          length: 'full',
          version: 3,
          formatVersion: 1,
          config: practiceRoomConfig,
        };
      },
      getFormatRevision: async (_id, version) => {
        reads.push(`revision-${version}`);
        return oneOnOneDefinition;
      },
    });
    const room = await resolveRoomChoice(store, {
      competitionType: 'ranked',
      formatId: 'one-on-one',
      length: 'full',
    });
    assert({
      given:
        'a current ranked preset pinning revision one while the format has moved on',
      should:
        'freeze its preset and historical format through the one compiler',
      actual: [
        reads,
        room.formatVersion,
        room.presetVersion,
        room.rules.segments.length,
      ],
      expected: [['preset', 'revision-1'], 1, 3, 7],
    });
  });

  test('ranked Room refuses missing sanction and missing historical definition', async () => {
    await assertRejects({
      given: 'no current approved preset for the ranked length',
      should: 'refuse ranked Room construction',
      actual: () =>
        resolveRoomChoice(reader(), {
          competitionType: 'ranked',
          formatId: 'one-on-one',
          length: 'full',
        }),
      code: 'CONFLICT',
    });
    const missingRevision = reader({
      getCurrentPreset: async () => ({
        formatId: 'one-on-one',
        length: 'full',
        version: 3,
        formatVersion: 1,
        config: practiceRoomConfig,
      }),
      getFormatRevision: async () => {
        throw createAppError('INVARIANT', 'No such revision');
      },
    });
    await assertRejects({
      given: 'a preset whose pinned definition revision is gone',
      should: 'refuse instead of compiling against the current definition',
      actual: () =>
        resolveRoomChoice(missingRevision, {
          competitionType: 'ranked',
          formatId: 'one-on-one',
          length: 'full',
        }),
      code: 'INVARIANT',
    });
  });

  test('practice Room uses current format and caller configuration', async () => {
    const room = await resolveRoomChoice(reader(), {
      competitionType: 'practice',
      formatId: 'one-on-one',
      length: 'full',
      config: practiceRoomConfig,
    });
    assert({
      given: 'an unranked practice Room choice',
      should: 'freeze current revision and no preset',
      actual: [room.formatVersion, room.presetVersion, room.config],
      expected: [2, null, practiceRoomConfig],
    });
  });
});

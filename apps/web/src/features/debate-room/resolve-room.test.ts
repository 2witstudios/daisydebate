import type { Database } from '@daisy/db';
import {
  oneOnOneDefinition,
  oneOnOneRoomConfig,
  referenceFormats,
  referencePresets,
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
          version: 3,
          formatVersion: 1,
          config: oneOnOneRoomConfig,
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
        }),
      code: 'CONFLICT',
    });
    const missingRevision = reader({
      getCurrentPreset: async () => ({
        formatId: 'one-on-one',
        version: 3,
        formatVersion: 1,
        config: oneOnOneRoomConfig,
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
        }),
      code: 'INVARIANT',
    });
  });

  test('casual Room uses current format and caller configuration', async () => {
    const room = await resolveRoomChoice(reader(), {
      competitionType: 'casual',
      formatId: 'one-on-one',
      config: oneOnOneRoomConfig,
    });
    assert({
      given: 'an unranked casual Room choice',
      should: 'freeze current revision and no preset',
      actual: [room.formatVersion, room.presetVersion, room.config],
      expected: [2, null, oneOnOneRoomConfig],
    });
  });

  test('every reference preset resolves against the revision it pins (DEC-234)', async () => {
    const revisionOf = async (formatId: string, version: number) => {
      const definition = referenceFormats.find(({ id }) => id === formatId)
        ?.revisions[version - 1];
      if (!definition) throw createAppError('INVARIANT', 'revision-not-found');
      return definition;
    };
    const resolved = await Promise.all(
      referencePresets.map(async (preset) => {
        const room = await resolveRoomChoice(
          reader({
            getCurrentPreset: async () => preset,
            getFormatRevision: revisionOf,
          }),
          {
            competitionType: 'ranked',
            formatId: preset.formatId,
          },
        );
        return [
          `v${preset.version}`,
          room.formatVersion,
          room.rules.segments.find(({ key }) => key === '1AR')?.durationMs,
        ];
      }),
    );
    assert({
      given: 'each approved preset, old and current',
      should:
        'resolve legally, the 1AR following its revision, and offer no quick preset (DEC-237)',
      actual: resolved,
      expected: [
        ['v1', 1, 300_000],
        ['v2', 2, 180_000],
      ],
    });
  });
});

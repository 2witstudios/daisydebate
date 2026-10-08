import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatDefinitionSchema, roomConfigSchema } from '@daisy/protocol';
import {
  referenceBots,
  referenceFormats,
  referencePresets,
  referenceAiJudge,
} from './reference-formats';

setupRitewayBun();

/** Every reference row the committed baseline inserts, parsed from its SQL. */
const migrated = async () => {
  const directory = new URL('../migrations/', import.meta.url).pathname;
  const sql = await Bun.file(
    `${directory}20261007000000_baseline/migration.sql`,
  ).text();
  const definitions = new Map<string, unknown>();
  for (const [, formatId, definition] of sql.matchAll(
    /'([a-z0-9-]+)', 1, '(\{.*?\})'::jsonb, statement_timestamp\(\)/g,
  ))
    definitions.set(formatId!, JSON.parse(definition!));
  const formats = new Map<string, { name: string }>();
  for (const [, id, name] of sql.matchAll(
    /'([a-z0-9-]+)', '([^']+)', 1, statement_timestamp\(\)/g,
  ))
    formats.set(id!, { name: (name ?? '').replaceAll("''", "'") });
  void formats;
  const presets: unknown[] = [];
  for (const [, formatId, length, config] of sql.matchAll(
    /'([a-z0-9-]+)', '(full|quick)', 1, 1, '(\{.*?\})'::jsonb/g,
  ))
    presets.push({ formatId, length, config: JSON.parse(config ?? '') });
  const bots: unknown[] = [];
  for (const [, actorId, name, persona, voice, difficulty] of sql.matchAll(
    /'([a-z0-9]{24})', '([^']+)', '([^']+)', '([^']+)', '(beginner|intermediate|advanced)'\)/g,
  ))
    bots.push({ actorId, name, persona, voice, difficulty });
  return { definitions, formats, presets, bots };
};

describe('reference data', () => {
  test('formats and definitions mirror exactly the rows the baseline inserts', async () => {
    const rows = await migrated();
    assert({
      given: 'the TypeScript reference formats and the committed baseline',
      should: 'name the same formats, names and definitions',
      actual: referenceFormats.map(({ id, definition }) => ({
        id,
        name: rows.formats.get(id)?.name,
        definition: rows.definitions.get(id),
        localDefinition: definition,
      })),
      expected: referenceFormats.map(({ id, name, definition }) => ({
        id,
        name,
        definition,
        localDefinition: definition,
      })),
    });
  });

  test('presets mirror the sanctioned configurations the baseline inserts', async () => {
    const rows = await migrated();
    assert({
      given: 'the TypeScript reference presets and the committed baseline',
      should: 'sanction the same configuration per format and length',
      actual: rows.presets,
      expected: referencePresets.map(({ formatId, length, config }) => ({
        formatId,
        length,
        config,
      })),
    });
  });

  test('bots and the AI judge ship as the baseline says', async () => {
    const rows = await migrated();
    assert({
      given: 'the bot roster and the committed baseline',
      should: 'seat the same actors with the same profiles',
      actual: rows.bots,
      expected: [...referenceBots, referenceAiJudge].map(
        ({ actorId, name, persona, voice, difficulty }) => ({
          actorId,
          name,
          persona,
          voice,
          difficulty,
        }),
      ),
    });
  });

  test('every reference definition and preset passes the protocol schemas', () => {
    assert({
      given: 'all reference formats and presets',
      should: 'each validate against the definition and config schemas',
      actual: {
        definitions: referenceFormats.map(
          ({ definition }) =>
            formatDefinitionSchema.safeParse(definition).success,
        ),
        configs: referencePresets.map(
          ({ config }) => roomConfigSchema.safeParse(config).success,
        ),
      },
      expected: {
        definitions: referenceFormats.map(() => true),
        configs: referencePresets.map(() => true),
      },
    });
  });

  test('the foundation format stays unjudged and unranked', () => {
    const foundation = referenceFormats.find(
      (format) => format.id === 'foundation',
    );
    assert({
      given: 'the foundation reference format',
      should:
        'offer no judge seat and hold no preset, so it never reaches a ladder',
      actual: {
        judge: foundation?.definition.seats.judge,
        presets: referencePresets.filter(
          ({ formatId }) => formatId === 'foundation',
        ).length,
      },
      expected: { judge: 0, presets: 0 },
    });
  });
});

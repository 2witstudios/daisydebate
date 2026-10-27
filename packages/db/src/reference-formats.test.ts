import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  type FormatDefinition,
} from '@daisy/protocol';
import {
  referenceBots,
  referenceFormats,
  referencePresets,
  referenceAiJudge,
} from './reference-formats';

setupRitewayBun();

import {
  committedMigrationSql,
  seededFormats,
  seededPresets,
} from './migrations.test-support';

setupRitewayBun();

/** Definitions as migrated, with whole-table JSON backfills applied in order. */
const migratedDefinitions = (sql: string) => {
  // Whole-table JSON backfills apply to every row written before them.
  const definitionBackfill = sql.indexOf(
    `UPDATE "format_revisions" SET "definition" = jsonb_set("definition", '{configurable,resolutionDraw}', 'null'::jsonb);`,
  );
  const presetBackfill = sql.indexOf(
    `UPDATE "format_presets" SET "config" = "config" || '{"resolutionDraw":{"enabled":false}}'::jsonb;`,
  );
  const before = (backfill: number, at: number | undefined) =>
    backfill >= 0 && (at ?? 0) < backfill;
  const definitions = new Map<string, unknown>();
  for (const match of sql.matchAll(
    /'([a-z0-9-]+)', (\d+), '(\{.*?\})'::jsonb, statement_timestamp\(\)/g,
  )) {
    const [, formatId, version, raw] = match;
    const definition = JSON.parse(raw!) as FormatDefinition;
    definitions.set(
      `${formatId}@${version}`,
      before(definitionBackfill, match.index)
        ? {
            ...definition,
            configurable: { ...definition.configurable, resolutionDraw: null },
          }
        : definition,
    );
  }
  return { definitions, presetBackfill, before };
};

/** Every reference row the committed migrations write, parsed in folder order. */
const migrated = async () => {
  const sql = await committedMigrationSql();
  const { definitions, presetBackfill, before } = migratedDefinitions(sql);
  const formats = new Map<string, { name: string; currentVersion: number }>();
  for (const [, id, name, version] of sql.matchAll(
    /'([a-z0-9-]+)', '([^']+)', (\d+), statement_timestamp\(\)/g,
  ))
    formats.set(id!, {
      name: (name ?? '').replaceAll("''", "'"),
      currentVersion: Number(version),
    });
  for (const [, version, id] of sql.matchAll(
    /UPDATE "formats" SET "current_version" = (\d+), "updated_at" = statement_timestamp\(\) WHERE "id" = '([a-z0-9-]+)'/g,
  ))
    formats.set(id!, { ...formats.get(id!)!, currentVersion: Number(version) });
  // Rows before DEC-237 carry a length; the quick ones are deleted later.
  const approved: {
    formatId: string;
    length: string | undefined;
    version: number;
    formatVersion: number;
    config: unknown;
  }[] = [];
  for (const match of sql.matchAll(
    /'([a-z0-9-]+)', (?:'(full|quick)', )?(\d+), (\d+), '(\{.*?\})'::jsonb/g,
  )) {
    const [, formatId, length, version, formatVersion, config] = match;
    const parsed = JSON.parse(config ?? '') as Record<string, unknown>;
    approved.push({
      formatId: formatId!,
      length,
      version: Number(version),
      formatVersion: Number(formatVersion),
      config: before(presetBackfill, match.index)
        ? { ...parsed, resolutionDraw: { enabled: false } }
        : parsed,
    });
  }
  const quickDeleted = sql.includes(
    `DELETE FROM "format_presets" WHERE "length" = 'quick';`,
  );
  const presets = approved
    .filter(({ length }) => !(quickDeleted && length === 'quick'))
    .map(({ formatId, version, formatVersion, config }) => ({
      formatId,
      version,
      formatVersion,
      config,
    }));
  const superseded = new Set<string>();
  for (const [, formatId, version] of sql.matchAll(
    /UPDATE "format_presets" SET "superseded_at" = statement_timestamp\(\) WHERE "format_id" = '([a-z0-9-]+)' AND (?:"length" = '(?:full|quick)' AND )?"version" = (\d+)/g,
  ))
    superseded.add(`${formatId}@${version}`);
  const bots: unknown[] = [];
  for (const [, actorId, name, persona, voice, difficulty] of sql.matchAll(
    /'([a-z0-9]{24})', '([^']+)', '([^']+)', '([^']+)', '(beginner|intermediate|advanced)'\)/g,
  ))
    bots.push({ actorId, name, persona, voice, difficulty });
  return { definitions, formats, presets, superseded, bots };
};

/** The newest approved revision per format: the one ranked play resolves. */
const currentReferencePresets = () =>
  referencePresets.filter(
    (preset) =>
      !referencePresets.some(
        (later) =>
          later.formatId === preset.formatId && later.version > preset.version,
      ),
  );

describe('reference data', () => {
  test('formats and every definition revision mirror exactly the rows the migrations write', async () => {
    const rows = await migrated();
    assert({
      given:
        'the TypeScript reference and catalog formats and the committed migrations',
      should:
        'name the same formats, every immutable revision and the current pointer',
      actual: {
        formats: seededFormats.map(({ id }) => ({
          id,
          ...rows.formats.get(id),
        })),
        definitions: Object.fromEntries(rows.definitions),
      },
      expected: {
        formats: seededFormats.map(({ id, name, revisions }) => ({
          id,
          name,
          currentVersion: revisions.length,
        })),
        definitions: Object.fromEntries(
          seededFormats.flatMap(({ id, revisions }) =>
            revisions.map((definition, index) => [
              `${id}@${index + 1}`,
              definition,
            ]),
          ),
        ),
      },
    });
  });

  test('presets mirror every sanctioned configuration the migrations approve', async () => {
    const rows = await migrated();
    assert({
      given: 'the TypeScript reference presets and the committed migrations',
      should:
        'approve the same full-length revisions, superseding all but the newest per format, and keep no quick preset (DEC-237)',
      actual: {
        approved: rows.presets,
        current: rows.presets.filter(
          ({ formatId, version }) =>
            !rows.superseded.has(`${formatId}@${version}`),
        ),
      },
      expected: {
        approved: seededPresets.map(
          ({ formatId, version, formatVersion, config }) => ({
            formatId,
            version,
            formatVersion,
            config,
          }),
        ),
        current: [
          ...currentReferencePresets(),
          ...seededPresets.slice(referencePresets.length),
        ].map(({ formatId, version, formatVersion, config }) => ({
          formatId,
          version,
          formatVersion,
          config,
        })),
      },
    });
  });

  test('one-on-one follows the standard one-on-one schedule in its second revision (DEC-234)', () => {
    const oneOnOne = referenceFormats.find(({ id }) => id === 'one-on-one');
    const defaults = (definition: FormatDefinition | undefined) =>
      Object.fromEntries(
        (definition?.segments ?? []).map((segment) => [
          segment.key,
          segment.defaultDurationMs,
        ]),
      );
    assert({
      given: 'the one-on-one revision history',
      should:
        'keep revision 1 as published and default the 1AR to 3:00 in revision 2, every other segment unchanged',
      actual: {
        revisions: oneOnOne?.revisions.length,
        first: defaults(oneOnOne?.revisions[0]),
        current: defaults(oneOnOne?.definition),
      },
      expected: {
        revisions: 2,
        first: {
          AC: 300_000,
          CX1: 120_000,
          NC: 360_000,
          CX2: 120_000,
          '1AR': 300_000,
          NR: 300_000,
          '2AR': 180_000,
        },
        current: {
          AC: 300_000,
          CX1: 120_000,
          NC: 360_000,
          CX2: 120_000,
          '1AR': 180_000,
          NR: 300_000,
          '2AR': 180_000,
        },
      },
    });
  });

  test('ranked play resolves against the current revision', () => {
    assert({
      given: 'the newest approved preset per format and length',
      should: "pin each to its format's current definition revision",
      actual: currentReferencePresets().map(({ formatId, formatVersion }) => [
        formatId,
        formatVersion,
      ]),
      expected: currentReferencePresets().map(({ formatId }) => [
        formatId,
        referenceFormats.find(({ id }) => id === formatId)?.revisions.length,
      ]),
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
        definitions: referenceFormats.flatMap(({ revisions }) =>
          revisions.map(
            (definition) =>
              formatDefinitionSchema.safeParse(definition).success,
          ),
        ),
        configs: referencePresets.map(
          ({ config }) => roomConfigSchema.safeParse(config).success,
        ),
      },
      expected: {
        definitions: referenceFormats.flatMap(({ revisions }) =>
          revisions.map(() => true),
        ),
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

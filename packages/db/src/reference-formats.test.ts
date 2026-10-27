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
import { catalogFormats } from './catalog-formats';

setupRitewayBun();

/** Every format the migrations seed: the reference rows, then the catalog (FMT-2a). */
const seededFormats = [
  ...referenceFormats.map(({ id, name, revisions }) => ({
    id,
    name,
    revisions,
  })),
  ...catalogFormats.map(({ id, name, definition }) => ({
    id,
    name,
    revisions: [definition],
  })),
];
const seededPresets = [
  ...referencePresets,
  ...catalogFormats.map(({ id, preset }) => ({
    formatId: id,
    version: 1,
    formatVersion: 1,
    config: preset,
  })),
];

/** Every reference row the committed migrations write, parsed in folder order. */
const migrated = async () => {
  const directory = new URL('../migrations/', import.meta.url).pathname;
  const folders = [...new Bun.Glob('*/migration.sql').scanSync(directory)]
    .map((path) => path.split('/')[0]!)
    .sort();
  const sql = (
    await Promise.all(
      folders.map((folder) =>
        Bun.file(`${directory}${folder}/migration.sql`).text(),
      ),
    )
  ).join('\n');
  const definitions = new Map<string, unknown>();
  for (const [, formatId, version, definition] of sql.matchAll(
    /'([a-z0-9-]+)', (\d+), '(\{.*?\})'::jsonb, statement_timestamp\(\)/g,
  ))
    definitions.set(`${formatId}@${version}`, JSON.parse(definition!));
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
  for (const [
    ,
    formatId,
    length,
    version,
    formatVersion,
    config,
  ] of sql.matchAll(
    /'([a-z0-9-]+)', (?:'(full|quick)', )?(\d+), (\d+), '(\{.*?\})'::jsonb/g,
  ))
    approved.push({
      formatId: formatId!,
      length,
      version: Number(version),
      formatVersion: Number(formatVersion),
      config: JSON.parse(config ?? ''),
    });
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

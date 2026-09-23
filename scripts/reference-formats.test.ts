import { formatRulesSchema } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { referenceFormats } from './reference-formats';

setupRitewayBun();

/** Every `INSERT INTO "formats"` row the committed migrations carry. */
const migratedFormats = async () => {
  const directory = new URL('../packages/db/migrations/', import.meta.url)
    .pathname;
  const rows: unknown[] = [];
  const pattern =
    /INSERT INTO "formats" \("id", "name", "rules", "ranked_eligible"\)\s*VALUES \('([^']+)', '([^']+)', '([^']+)'::jsonb, (true|false)\)/g;
  for (const path of [
    ...new Bun.Glob('*/migration.sql').scanSync(directory),
  ].sort())
    for (const [, id, name, rules, ranked] of (
      await Bun.file(`${directory}${path}`).text()
    ).matchAll(pattern))
      rows.push({
        id,
        name,
        rankedEligible: ranked === 'true',
        rules: JSON.parse(rules ?? 'null'),
      });
  return rows;
};

describe('reference formats', () => {
  test('mirror exactly the rows the migrations insert', async () => {
    assert({
      given: 'the TypeScript reference formats and the committed migrations',
      should: 'name the same rows with the same rules',
      actual: await migratedFormats(),
      expected: referenceFormats,
    });
  });

  test('seed the unjudged foundation format with valid rules', () => {
    const foundation = referenceFormats.find(
      (format) => format.id === 'foundation',
    );
    assert({
      given: 'the foundation reference format',
      should:
        'pass the protocol rules schema with one seat per side and no judge',
      actual: {
        parsed: formatRulesSchema.safeParse(foundation?.rules).success,
        seats: foundation?.rules.seats,
        rankedEligible: foundation?.rankedEligible,
      },
      expected: {
        parsed: true,
        seats: { affirmative: 1, negative: 1, judge: 0 },
        rankedEligible: false,
      },
    });
  });

  test('every reference rules value passes the protocol schema', () => {
    assert({
      given: 'all reference formats',
      should: 'each validate against formatRulesSchema',
      actual: referenceFormats.map(
        (format) => formatRulesSchema.safeParse(format.rules).success,
      ),
      expected: referenceFormats.map(() => true),
    });
  });
});

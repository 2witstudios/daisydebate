import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolutionBankRevision1 } from './resolution-bank';
import { committedMigrationSql } from './migrations.test-support';

setupRitewayBun();

/** Every bank entry the committed migrations insert, in folder order. */
const migratedEntries = async () => {
  const sql = await committedMigrationSql();
  return [
    ...sql.matchAll(
      /\('([a-z0-9]{24})', '((?:[^']|'')*)', '(policy|value|fact)', '(intro|standard|advanced)', '([a-z-]+)', '([^']+)', (\d+)\)/g,
    ),
  ].map(([, id, text, category, difficulty, locale, provenance, revision]) => ({
    id,
    text: text!.replaceAll("''", "'"),
    category,
    difficulty,
    locale,
    provenance,
    revision: Number(revision),
  }));
};

test('the migrations seed exactly revision 1 of the curated bank', async () => {
  const entries = resolutionBankRevision1.entries.map((entry) => ({
    ...entry,
    revision: resolutionBankRevision1.revision,
  }));
  assert({
    given: 'the TypeScript bank and the committed migrations',
    should: 'insert the same entries, in order, at revision 1',
    actual: await migratedEntries(),
    expected: entries,
  });
  assert({
    given: 'revision 1',
    should: 'balance policy, value and fact with no duplicate text',
    actual: [
      ['policy', 'value', 'fact'].map(
        (category) =>
          entries.filter((entry) => entry.category === category).length,
      ),
      new Set(entries.map((entry) => entry.text.toLowerCase())).size,
    ],
    expected: [[14, 14, 14], entries.length],
  });
});

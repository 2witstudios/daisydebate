import { fileURLToPath } from 'node:url';
import { readMigrationConfig } from '@daisy/config';
import { adoptBaseline } from '../src/baseline/adoption';

// `bun db:adopt-baseline` (RECON-5.2, ADR 0913): the owner runs it once per
// database migrated the old way, as the migration owner, from the image of
// the release that carries the baseline (docs/operations/database.md).
// ADOPTION_REFERENCE_DATABASE names an empty database on the same cluster,
// owned by the migration owner; the command reaches it with the migration
// credential, so no second credential is passed. The operator drops it
// afterwards.
const { databaseUrl } = readMigrationConfig(process.env);
const reference = process.env.ADOPTION_REFERENCE_DATABASE ?? '';
const live = new URL(databaseUrl);
if (
  !/^[a-z_][a-z0-9_]*$/.test(reference) ||
  `/${reference}` === live.pathname
) {
  process.stderr.write(
    'adopt-baseline: ADOPTION_REFERENCE_DATABASE must name another, empty database on the same cluster\n',
  );
  process.exit(1);
}
const referenceUrl = new URL(databaseUrl);
referenceUrl.pathname = `/${reference}`;
// `--check` proves the adoption and stops before the swap: run it from the
// PR's image before merging, while the old image can still ship a fix.
const mode = process.argv.includes('--check') ? 'check' : 'adopt';
const outcome = await adoptBaseline({
  mode,
  databaseUrl,
  referenceUrl: referenceUrl.toString(),
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});
if (outcome.kind === 'refused') {
  process.stderr.write(
    `adopt-baseline: refused; nothing changed\n${outcome.reasons.map((reason) => `  ${reason}\n`).join('')}`,
  );
  process.exit(1);
}
process.stdout.write(
  outcome.kind === 'adoptable'
    ? `adopt-baseline --check: adoptable; ${outcome.baseline} would replace ${outcome.superseded} journal rows, ${outcome.later.length} later folders kept; nothing changed\n`
    : `adopt-baseline: ${outcome.baseline} replaces ${outcome.superseded} journal rows; ${outcome.later.length} later folders kept\n`,
);

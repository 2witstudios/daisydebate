import { fileURLToPath } from 'node:url';
import { readMigrationConfig } from '@daisy/config';
import { adoptBaseline } from '../src/baseline/adoption';

// `bun db:adopt-baseline` (RECON-5.2, ADR 0913): the owner runs it once per
// database migrated the old way, as the migration owner, from the image of
// the release that carries the baseline (docs/operations/database.md).
// ADOPTION_REFERENCE_DATABASE_URL names an empty database on the same
// cluster, owned by the migration owner; the operator drops it afterwards.
const { databaseUrl } = readMigrationConfig(process.env);
const referenceUrl = process.env.ADOPTION_REFERENCE_DATABASE_URL;
if (!referenceUrl) {
  process.stderr.write(
    'adopt-baseline: ADOPTION_REFERENCE_DATABASE_URL must name an empty database on the same cluster\n',
  );
  process.exit(1);
}
if (new URL(referenceUrl).pathname === new URL(databaseUrl).pathname) {
  process.stderr.write(
    'adopt-baseline: the reference must be another database\n',
  );
  process.exit(1);
}
const outcome = await adoptBaseline({
  databaseUrl,
  referenceUrl,
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});
if (outcome.kind === 'refused') {
  process.stderr.write(
    `adopt-baseline: refused; nothing changed\n${outcome.reasons.map((reason) => `  ${reason}\n`).join('')}`,
  );
  process.exit(1);
}
process.stdout.write(
  `adopt-baseline: ${outcome.baseline} replaces ${outcome.superseded} journal rows; ${outcome.later.length} later folders kept\n`,
);

import { SQL } from 'bun';

/**
 * Fixture-only read for the Node-driven proof: a Round's own read belongs to its
 * seats, so whether one finished after its accounts closed is read directly.
 */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This read runs only against an E2E database');
  const sql = new SQL(target, { max: 1 });
  try {
    const [round] =
      await sql`select completed_at is not null as finished from rounds where id = ${Bun.argv[2]!}`;
    process.stdout.write(String(round?.finished ?? false));
  } finally {
    await sql.close();
  }
}

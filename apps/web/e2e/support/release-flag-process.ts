import { SQL } from 'bun';

/**
 * Fixture-only write: the browser suite runs with every release flag at its
 * safe default (off), so a spec for a flagged page stores that flag's state
 * directly. `bun release-flag-process.ts <key> enabled|default`.
 */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This write runs only against an E2E database');
  const [key, state] = [Bun.argv[2]!, Bun.argv[3]!];
  if (state !== 'enabled' && state !== 'default')
    throw new Error(`Unsupported fixture state: ${state}`);
  const sql = new SQL(target, { max: 1 });
  try {
    await sql`insert into release_flags (key, state, revision)
      values (${key}, ${state}, 1)
      on conflict (key) do update
        set state = excluded.state, revision = release_flags.revision + 1`;
  } finally {
    await sql.close();
  }
}

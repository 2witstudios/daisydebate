/**
 * The one check `scripts/post-restore-invalidate.ts` runs before opening any
 * connection: a database name that does not name itself a restore copy
 * refuses the command outright, `--force` aside. Pure so it is unit-tested
 * without a database.
 */
export function refusalFor(
  databaseUrl: string,
  force: boolean,
): string | undefined {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (force || name.toLowerCase().includes('restore')) return undefined;
  return (
    `Refusing: DATABASE_URL's database "${name}" does not name itself a ` +
    'restore copy (expected "restore" in the name). Pass --force only for ' +
    'a database you have independently confirmed is an isolated restore ' +
    'copy, never one taking live traffic.'
  );
}

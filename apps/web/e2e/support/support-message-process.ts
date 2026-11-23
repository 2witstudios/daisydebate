import { SQL } from 'bun';

/**
 * Fixture-only reads and cleanup for the support spec:
 * `bun support-message-process.ts count|remove <marker>` counts or deletes
 * the messages whose about line ends with the spec's own marker.
 */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This read runs only against an E2E database');
  const [verb, marker] = [Bun.argv[2]!, Bun.argv[3]!];
  if (!/^[a-z0-9]{24}$/.test(marker)) throw new Error('Unsupported marker');
  const sql = new SQL(target, { max: 1 });
  try {
    const pattern = `%${marker}`;
    if (verb === 'count') {
      const [row] =
        (await sql`select count(*)::int as count, min(state) as state,
          min(topic) as topic, min(reply_email) as reply_email
        from support_messages where about like ${pattern}`) as Array<{
          count: number;
          state: string | null;
          topic: string | null;
          reply_email: string | null;
        }>;
      process.stdout.write(JSON.stringify(row));
    } else if (verb === 'remove') {
      await sql`delete from support_messages where about like ${pattern}`;
    } else throw new Error(`Unsupported verb: ${verb}`);
  } finally {
    await sql.close();
  }
}

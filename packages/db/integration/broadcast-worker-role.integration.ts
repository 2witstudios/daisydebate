import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the hold worker can reach broadcasts and nothing else', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const can = async (table: string, privilege: string) =>
      (
        await sql`select (has_table_privilege('daisy_broadcast_worker', ${table}, ${privilege}) or (lower(${privilege}) in ('select', 'update') and has_any_column_privilege('daisy_broadcast_worker', ${table}, ${privilege}))) as ok`
      )[0].ok as boolean;
    assert({
      given: 'the worker role',
      should:
        'read and update broadcasts, never insert or delete them, and hold nothing on Rounds, seats or accounts',
      actual: [
        await can('broadcasts', 'SELECT'),
        await can('broadcasts', 'UPDATE'),
        await can('broadcasts', 'INSERT'),
        await can('broadcasts', 'DELETE'),
        await can('rounds', 'SELECT'),
        await can('round_participants', 'SELECT'),
        await can('ballots', 'SELECT'),
        await can('users', 'SELECT'),
      ],
      expected: [true, true, false, false, false, false, false, false],
    });
  } finally {
    await sql.close();
  }
});

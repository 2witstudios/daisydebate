import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readOutboxRetentionBoundary } from '../src/outbox-retention-boundary';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('migration creates a conservative boundary with only narrow maintenance and realtime privileges', async () => {
  const client = new SQL(databaseUrl);
  try {
    await client.begin(async (tx) => {
      await tx`set local role daisy_realtime`;
      await tx`create temporary table outbox_retention_boundary(txid text,seq text,singleton boolean) on commit drop`;
      await tx`insert into pg_temp.outbox_retention_boundary values('0','0',true)`;
      const position = await readOutboxRetentionBoundary(
        drizzle({ client: tx }),
      );
      assert({
        given:
          'the migration-created singleton, including an empty delivery log',
        should: 'retain a non-origin migration fence readable by realtime',
        actual: [
          position !== null && BigInt(position.txid) > 0n,
          position?.seq,
        ],
        expected: [true, 0n],
      });
    });
    for (const statement of [
      'update public.outbox_retention_boundary set seq=seq',
      'delete from public.outbox_retention_boundary',
      "insert into public.outbox_retention_boundary values(true,'0'::xid8,0)",
    ]) {
      assert({
        given: 'the realtime role attempting to change its history boundary',
        should: 'refuse all mutation privileges',
        actual: await sqlStateOf(() =>
          client.begin(async (tx) => {
            await tx`set local role daisy_realtime`;
            await tx.unsafe(statement);
          }),
        ),
        expected: '42501',
      });
    }
    await client.begin(async (tx) => {
      await tx`set local role daisy_web`;
      const rows =
        await tx`update public.outbox_retention_boundary set txid=txid,seq=seq returning singleton`;
      assert({
        given: 'the trusted maintenance adapter role',
        should: 'update ordering columns on exactly the migration-created row',
        actual: rows.length,
        expected: 1,
      });
    });
    assert({
      given: 'maintenance attempting to change singleton identity',
      should: 'refuse privilege outside the two ordering columns',
      actual: await sqlStateOf(() =>
        client.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`update public.outbox_retention_boundary set singleton=false`;
        }),
      ),
      expected: '42501',
    });
    for (const statement of [
      'delete from public.outbox_retention_boundary',
      "insert into public.outbox_retention_boundary values(true,'0'::xid8,0)",
    ]) {
      assert({
        given: 'maintenance attempting to replace or remove the fixed boundary',
        should: 'refuse inherited table DML beyond ordering-column updates',
        actual: await sqlStateOf(() =>
          client.begin(async (tx) => {
            await tx`set local role daisy_web`;
            await tx.unsafe(statement);
          }),
        ),
        expected: '42501',
      });
    }
  } finally {
    await client.close();
  }
});

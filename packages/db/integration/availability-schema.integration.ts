import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, sqlStateOf, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('service leases preserve composite delivery positions and role-bound write privilege', async () => {
  await withFixture(url, async (fixture) => {
    const web = createId(),
      realtime = createId();
    try {
      await fixture.sql.unsafe(
        "insert into service_instances(instance_id,role,renewed_at) values($1,'web',statement_timestamp())",
        [web],
      );
      assert({
        given: 'a realtime lease missing its transaction-ordered cursor',
        should: 'refuse a sequence-only health witness',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "insert into service_instances(instance_id,role,renewed_at,delivered_through) values($1,'realtime',statement_timestamp(),1)",
            [realtime],
          ),
        ),
        expected: 'service_instances_cursor_check',
      });
      await fixture.sql.unsafe(
        "insert into service_instances(instance_id,role,renewed_at,delivered_through,delivered_through_txid) values($1,'realtime',statement_timestamp(),0,'0'::xid8)",
        [realtime],
      );
      for (const role of ['daisy_realtime', 'daisy_web']) {
        const own = role === 'daisy_realtime' ? realtime : web;
        const other = role === 'daisy_realtime' ? web : realtime;
        const foreignRole = role === 'daisy_realtime' ? 'web' : 'realtime';
        const connection = await fixture.sql.reserve();
        await connection.unsafe(`set role ${role}`);
        try {
          const update = await sqlStateOf(() =>
            connection.unsafe(
              'update service_instances set renewed_at=statement_timestamp() where instance_id=$1',
              [own],
            ),
          );
          const foreignUpdate = await sqlStateOf(() =>
            connection.unsafe(
              'update service_instances set renewed_at=statement_timestamp() where instance_id=$1',
              [other],
            ),
          );
          const reassign = await sqlStateOf(() =>
            connection.unsafe(
              'update service_instances set instance_id=$2 where instance_id=$1',
              [own, createId()],
            ),
          );
          const foreignInsert = await sqlStateOf(() =>
            connection.unsafe(
              'insert into service_instances(instance_id,role,renewed_at,delivered_through,delivered_through_txid) values($1,$2,statement_timestamp(),$3,$4::xid8)',
              [
                createId(),
                foreignRole,
                foreignRole === 'web' ? null : 0,
                foreignRole === 'web' ? null : '0',
              ],
            ),
          );
          assert({
            given: `actual ${role} lease writer`,
            should: 'renew only its role without moving instance identity',
            actual: { update, foreignUpdate, reassign, foreignInsert },
            expected: {
              update: 'accepted',
              foreignUpdate: '42501',
              reassign: '23514',
              foreignInsert: '42501',
            },
          });
          if (role === 'daisy_realtime')
            assert({
              given: 'the realtime heartbeat exception',
              should: 'deny lease deletion and every availability write',
              actual: await Promise.all([
                sqlStateOf(() =>
                  connection.unsafe(
                    'delete from service_instances where instance_id=$1',
                    [own],
                  ),
                ),
                sqlStateOf(() =>
                  connection.unsafe(
                    'insert into availability_samples(at,healthy) values(statement_timestamp(),true)',
                  ),
                ),
              ]),
              expected: ['42501', '42501'],
            });
        } finally {
          await connection.unsafe('reset role');
          connection.release();
        }
      }
    } finally {
      await fixture.sql.unsafe('reset role');
      await fixture.sql.unsafe(
        'delete from service_instances where instance_id in ($1,$2)',
        [web, realtime],
      );
    }
  });
});

test('availability samples are immutable and strictly ordered with honest bounded causes', async () => {
  await withFixture(url, async (fixture) => {
    const at = '2001-01-01T00:00:00Z';
    try {
      await fixture.sql.unsafe(
        'insert into availability_samples(at,healthy) values($1,true)',
        [at],
      );
      assert({
        given: 'a sample older than the committed horizon',
        should: 'refuse backwards history',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "insert into availability_samples(at,healthy,cause) values('2000-01-01',false,'check_in_pending')",
          ),
        ),
        expected: 'availability_samples_monotone',
      });
      assert({
        given: 'an unhealthy sample without a reason',
        should: 'refuse ambiguous health evidence',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "insert into availability_samples(at,healthy) values('2002-01-01',false)",
          ),
        ),
        expected: 'availability_samples_cause_check',
      });
      assert({
        given: 'the retired global control worker cause (DEC-193)',
        should: 'refuse it as a reason for unhealthy availability',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "insert into availability_samples(at,healthy,cause) values('2002-01-01',false,'control_worker_unknown')",
          ),
        ),
        expected: 'availability_samples_cause_check',
      });
      await fixture.sql.unsafe(
        "insert into availability_samples(at,healthy,cause) values('2002-01-01',false,'check_in_pending')",
      );
      assert({
        given: 'an accepted historical health sample',
        should: 'refuse rewriting its cause',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "update availability_samples set cause='web_stale' where at='2002-01-01'",
          ),
        ),
        expected: 'availability_samples_immutable',
      });
    } finally {
      await fixture.sql.unsafe(
        "delete from availability_samples where at in ('2001-01-01','2002-01-01')",
      );
    }
  });
});

import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

async function blocked(observer: SQL, pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] =
      await observer`select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))`;
    if (row) return;
    await Bun.sleep(5);
  }
  throw new Error('Discovery did not reach the held authority lock');
}
type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
async function waitOnRoom(
  f: Runtime,
  holder: SQL,
  pid: number,
  id: string,
  title: string,
) {
  await holder`select id from rooms where id=${id} for update`;
  const reading = f.operations.list(f.outsider, { q: title, pageSize: 1 });
  await blocked(f.sql, pid);
  return { reading };
}
async function withHeld(run: (holder: SQL, pid: number) => Promise<void>) {
  const holder = new SQL(databaseUrl, { max: 1 });
  try {
    await holder.unsafe('BEGIN');
    const [row] = await holder`select pg_backend_pid() pid`;
    await run(holder, row!.pid);
  } finally {
    await holder.unsafe('ROLLBACK');
    await holder.close();
  }
}

test('live discovery preserves frozen Round visibility and seats without Redis consent', async () => {
  await withRoomRuntime(async (f) => {
    const title = createId();
    let view = await f.assemble({ title });
    view = (await f.command(f.host, view, { type: 'start-round' })).view;
    const roundId = view.roundRef!.id;
    const consentReads = f.consentReads();
    f.unavailable(true);
    const list = (who = f.outsider) =>
      f.operations.list(who, { q: title, pageSize: 1 });
    const scheduled = await list();
    await f.sql`update rounds set status='active',current_stage='countdown',started_at=statement_timestamp() where id=${roundId}`;
    const active = await list();
    await f.sql`update rounds set visibility='private' where id=${roundId}`;
    const hidden = await list(),
      seated = await list(f.guest),
      host = await list(f.host);
    await f.sql`delete from room_participants where room_id=${view.id} and actor_id=${f.guest.actorId}`;
    const frozenSeat = await list(f.guest);
    await f.sql`update rounds set status='completed',current_stage=null,outcome='affirmative',completed_at=statement_timestamp() where id=${roundId}`;
    const completed = await list(f.host);
    await f.sql`update rounds set status='abandoned',outcome=null where id=${roundId}`;
    const abandoned = await list(f.host);
    assert({
      given:
        'public started Room, private frozen Round and a frozen participant removed from current Room seats',
      should:
        'authorize from frozen Round facts, preserve both live states and exclude terminal history without Redis reads',
      actual: [
        scheduled.rooms.map((r) => r.roundRef?.status),
        active.rooms.map((r) => r.roundRef?.status),
        hidden.rooms.length,
        seated.rooms.length,
        host.rooms.length,
        frozenSeat.rooms.length,
        completed.rooms.length,
        abandoned.rooms.length,
        f.consentReads() - consentReads,
      ],
      expected: [['scheduled'], ['active'], 0, 1, 1, 1, 0, 0, 0],
    });
    assert({
      given: 'the lightweight discovery projection',
      should: 'omit aggregate and consent data',
      actual: Object.keys(scheduled.rooms[0]!).sort(),
      expected: [
        'id',
        'version',
        'title',
        'topic',
        'visibility',
        'hostActorId',
        'hostLabel',
        'status',
        'competitionType',
        'length',
        'seated',
        'roundRef',
      ].sort(),
    });
  });
});

test('selected Room locks recheck visibility, participant and status races with safe retry', async () => {
  await withRoomRuntime(async (f) => {
    for (const change of ['visibility', 'seat', 'status'] as const) {
      const title = createId();
      const view = (
        await f.create({
          title,
          visibility: change === 'seat' ? 'private' : 'public',
        })
      ).view;
      if (change === 'seat')
        await f.sql`insert into room_participants(id,room_id,actor_id,role,slot) values (${createId()},${view.id},${f.guest.actorId},'negative',0)`;
      await withHeld(async (holder, pid) => {
        await holder`select id from rooms where id=${view.id} for update`;
        const reading = f.operations.list(f.guest, { q: title, pageSize: 1 });
        await blocked(f.sql, pid);
        if (change === 'visibility')
          await holder`update rooms set visibility='private' where id=${view.id}`;
        if (change === 'seat')
          await holder`delete from room_participants where room_id=${view.id} and actor_id=${f.guest.actorId}`;
        if (change === 'status')
          await holder`update rooms set status='abandoned' where id=${view.id}`;
        await holder.unsafe('COMMIT');
        const page = await reading;
        assert({
          given: `a ${change} change while discovery waits on its selected Room`,
          should:
            'mask all data and ids and explicitly retry rather than report false end',
          actual: page,
          expected: { rooms: [], nextCursor: null, retry: true },
        });
        const retry = await f.operations.list(f.guest, {
          q: title,
          pageSize: 1,
        });
        assert({
          given: 'a retry after the transition commits',
          should: 'observe an authoritative empty end without refill',
          actual: retry,
          expected: { rooms: [], nextCursor: null, retry: false },
        });
      });
    }
  });
});

test('selected Round locks recheck frozen visibility and terminal status races', async () => {
  await withRoomRuntime(async (f) => {
    for (const change of ['visibility', 'status', 'seat'] as const) {
      const title = createId();
      let view = await f.assemble({ title });
      view = (await f.command(f.host, view, { type: 'start-round' })).view;
      if (change === 'seat')
        await f.sql`update rounds set visibility='private' where id=${view.roundRef!.id}`;
      await withHeld(async (holder, pid) => {
        await holder`select id from rounds where id=${view.roundRef!.id} for update`;
        const reading = f.operations.list(
          change === 'seat' ? f.guest : f.outsider,
          {
            q: title,
            pageSize: 1,
          },
        );
        await blocked(f.sql, pid);
        if (change === 'visibility')
          await holder`update rounds set visibility='private' where id=${view.roundRef!.id}`;
        else if (change === 'seat')
          await holder`delete from round_participants where round_id=${view.roundRef!.id} and actor_id=${f.guest.actorId}`;
        else
          await holder`update rounds set status='abandoned',completed_at=statement_timestamp() where id=${view.roundRef!.id}`;
        await holder.unsafe('COMMIT');
        assert({
          given: `a frozen Round ${change} transition during selected Round lock wait`,
          should: 'remove View Round and Room identifiers with explicit retry',
          actual: await reading,
          expected: { rooms: [], nextCursor: null, retry: true },
        });
      });
    }
  });
});

test('canonical account fence masks revoked and substituted membership before discovery', async () => {
  await withRoomRuntime(async (f) => {
    await f.create();
    await withHeld(async (holder, pid) => {
      await holder.unsafe(
        'select * from daisy_authorization_accounts(array[$1]::text[],null::text,true)',
        [f.guest.actorId],
      );
      const reading = f.operations.list(f.guest, { q: '', pageSize: 1 });
      const refusal = assertRejects({
        given: 'membership revoked while list waits on canonical account fence',
        should: 'refuse with authorization',
        actual: () => reading,
        code: 'AUTHORIZATION',
      });
      await blocked(f.sql, pid);
      await holder`update users set email_verified=false where id=${f.guest.userId}`;
      await holder.unsafe('COMMIT');
      await refusal;
    });
    await assertRejects({
      given: 'a caller bound to another actor',
      should: 'refuse through the canonical evaluator',
      actual: () =>
        f.operations.list(
          { ...f.host, actorId: f.outsider.actorId },
          { q: '', pageSize: 1 },
        ),
      code: 'AUTHORIZATION',
    });
  });
});

test('masked page-plus-one races preserve accessible continuation and bounded retry progress', async () => {
  await withRoomRuntime(async (f) => {
    const title = createId();
    const views = [
      (await f.create({ title })).view,
      (await f.create({ title })).view,
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    await withHeld(async (holder, pid) => {
      const { reading } = await waitOnRoom(f, holder, pid, views[0]!.id, title);
      await holder`update rooms set visibility='private' where id=${views[1]!.id}`;
      await holder.unsafe('COMMIT');
      const page = await reading;
      assert({
        given: 'the unselected page-plus-one candidate becomes private',
        should: 'continue only from the returned accessible id',
        actual: [page.rooms.map((r) => r.id), page.nextCursor, page.retry],
        expected: [[views[0]!.id], views[0]!.id, false],
      });
      assert({
        given: 'next page after the masked sentinel',
        should: 'return the actual end without revealing hidden id',
        actual: await f.operations.list(f.outsider, {
          q: title,
          pageSize: 1,
          cursor: page.nextCursor!,
        }),
        expected: { rooms: [], nextCursor: null, retry: false },
      });
    });
    await f.sql`update rooms set visibility='public' where id=${views[1]!.id}`;
    await withHeld(async (holder, pid) => {
      const { reading } = await waitOnRoom(f, holder, pid, views[0]!.id, title);
      await holder`update rooms set visibility='private' where id=${views[0]!.id}`;
      await holder.unsafe('COMMIT');
      assert({
        given:
          'the selected row becomes private while a stable accessible successor exists',
        should:
          'request retry with no hidden cursor instead of false terminal or unbounded refill',
        actual: await reading,
        expected: { rooms: [], nextCursor: null, retry: true },
      });
      const retry = await f.operations.list(f.outsider, {
        q: title,
        pageSize: 1,
      });
      assert({
        given: 'retry of the same bounded query',
        should: 'make progress to the stable accessible successor',
        actual: [retry.rooms.map((r) => r.id), retry.nextCursor, retry.retry],
        expected: [[views[1]!.id], null, false],
      });
    });
  });
});

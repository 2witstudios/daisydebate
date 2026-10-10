import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { encodeOutboxCursor } from '@daisy/db';
import {
  finishedOrBlockedBehind,
  waitForOutboxFinality,
} from '@daisy/db/testing';
import {
  socketAuthorityFixture,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { openAuthorityPeer } from './authority-peer.test-support';
import { insertOutboxRow, notifyOutbox, waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

test('real SQL catchup wait racing a committed write delivers history and live invalidation once', async () => {
  const fixture = await socketAuthorityFixture();
  const topic = 'standings:catchup-wait';
  const positions: Array<{ txid: string; seq: bigint }> = [];
  let release = () => {};
  let locked: Promise<unknown> | undefined;
  try {
    const append = async (entityVersion: number) => {
      const position = await insertOutboxRow(fixture.client, {
        topic,
        kind: 'standings.updated',
        version: 1,
        payload: {
          kind: 'standings.updated',
          ids: [fixture.actorId],
          entityVersion,
        },
      });
      positions.push(position);
      await notifyOutbox(fixture.client, position);
      return position;
    };
    const baseline = await append(1);
    const history = await append(2);
    await waitFor(
      () =>
        encodeOutboxCursor(fixture.runtime.drain.cursor()) ===
        encodeOutboxCursor(history),
    );
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Actual authority listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket(fixture),
    );
    let acceptLock: (pid: number) => void = () => {};
    const ready = new Promise<number>((accept) => {
      acceptLock = accept;
    });
    const unlock = new Promise<void>((accept) => {
      release = accept;
    });
    locked = fixture.client.begin(async (tx) => {
      await tx`lock table public.outbox_retention_boundary in access exclusive mode`;
      const [backend] = await tx`select pg_backend_pid() as pid`;
      acceptLock(Number(backend.pid));
      await unlock;
    });
    const holderPid = await ready;
    const subscribed = peer.subscribe(
      topic,
      'racing-history',
      encodeOutboxCursor(baseline),
    );
    const blocked = await finishedOrBlockedBehind(
      subscribed,
      fixture.client,
      holderPid,
      { now: Date.now },
    );
    const [query] =
      await fixture.client`select count(*)::int as waiting from pg_stat_activity
      where ${holderPid} = any(pg_blocking_pids(pid)) and query like '%with retained as%'`;
    // Commit while the snapshot SELECT is physically blocked. Finality is
    // awaited after the holder exits, independently of its xid assignment.
    const [written] =
      await fixture.client`insert into outbox(topic,kind,version,payload)
      values(${topic},'standings.updated',1,
      ${{ kind: 'standings.updated', ids: [fixture.actorId], entityVersion: 3 }}::jsonb)
      returning txid::text as txid,seq`;
    if (!written) throw new Error('Racing durable row unavailable');
    const racing = { txid: String(written.txid), seq: BigInt(written.seq) };
    positions.push(racing);
    release();
    await locked;
    await waitForOutboxFinality(fixture.client, racing.txid, { now: Date.now });
    await notifyOutbox(fixture.client, racing);
    const acknowledgement = await subscribed;
    await waitFor(() =>
      peer.frames.some(
        (frame) =>
          frame.type === 'event' &&
          frame.position === encodeOutboxCursor(racing),
      ),
    );
    await fixture.runtime.delivery.registry.settled();
    assert({
      given:
        'the actual restricted-role snapshot query blocked by a PostgreSQL retention-table lock while a new outbox transaction commits',
      should:
        'replay through C then deliver the racing position once, with a native subscribed acknowledgement',
      actual: {
        blocked,
        snapshotQueries: Number(query.waiting),
        acknowledged: acknowledgement.type,
        positions: peer.frames.flatMap((frame) =>
          frame.type === 'event' ? [frame.position] : [],
        ),
      },
      expected: {
        blocked: 'blocked',
        snapshotQueries: 1,
        acknowledged: 'subscribed',
        positions: [encodeOutboxCursor(history), encodeOutboxCursor(racing)],
      },
    });
  } finally {
    release();
    await locked;
    await fixture.runtime.close();
    for (const row of positions)
      await fixture.client`delete from outbox where txid=${row.txid}::xid8 and seq=${row.seq}`;
    await fixture.close();
  }
});

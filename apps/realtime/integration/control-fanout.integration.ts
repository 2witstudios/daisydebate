import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { encodeOutboxCursor } from '@daisy/db';
import { waitForOutboxFinality } from '@daisy/db/testing';
import { buildUserInboxTopic } from '@daisy/protocol';
import { serveRealtime } from '../src/serve';
import { authorityResources } from './authority-resources.test-support';
import type { SocketData } from '../src/socket';
import {
  socketAuthorityFixture,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { openAuthorityPeer } from './authority-peer.test-support';
import { roundAudienceFixture } from './round-audience.test-support';
import { observeNativeServe } from './paused-reader.test-support';
import { notifyOutbox, waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

test('two actual instances consume durable access and session revocations without event-delivering controls', async () => {
  const sockets: Bun.ServerWebSocket<SocketData>[] = [];
  const observe = observeNativeServe((socket) => sockets.push(socket));
  const fixture = await socketAuthorityFixture(observe);
  const rounds = roundAudienceFixture(fixture.client, fixture.actorId);
  const positions: Array<{ txid: string; seq: bigint }> = [];
  let replicaResources:
    Awaited<ReturnType<typeof authorityResources>> | undefined;
  let replica: Awaited<ReturnType<typeof serveRealtime>> | undefined;
  try {
    replicaResources = await authorityResources(
      requireTestServices(process.env),
      fixture.resources.clock,
    );
    replica = await serveRealtime({
      resources: replicaResources,
      serve: observe,
      port: 0,
      hostname: '127.0.0.1',
      now: () => 0,
    });
    const round = await rounds.seed('private', 'affirmative');
    const peers = [];
    const acknowledgements: string[] = [];
    for (const runtime of [fixture.runtime, replica]) {
      const port = runtime.server.port;
      if (port === undefined)
        throw new Error('Actual authority listener unavailable');
      const peer = await openAuthorityPeer(
        port,
        await issueAuthorityTicket({
          ...fixture,
          resources: runtime === replica ? replicaResources : fixture.resources,
        }),
      );
      acknowledgements.push(
        (await peer.subscribe(round.topic, 'private-round')).type,
      );
      acknowledgements.push(
        (
          await peer.subscribe(
            buildUserInboxTopic(fixture.actorId),
            'own-inbox',
          )
        ).type,
      );
      peers.push(peer);
    }
    assert({
      given: 'both actual listeners using independent restricted-role pools',
      should:
        'accept the persisted private seat and own inbox before revocation',
      actual: acknowledgements,
      expected: ['subscribed', 'subscribed', 'subscribed', 'subscribed'],
    });
    const control = async (
      kind: 'access.revoked' | 'session.revoked',
      target: string,
    ) => {
      const rows = await fixture.client.begin(async (tx) => {
        if (kind === 'access.revoked') {
          await tx`delete from round_participants where round_id=${round.id} and actor_id=${fixture.actorId}`;
          await tx`update rounds set version=version+1 where id=${round.id}`;
        } else await tx`delete from session where id=${fixture.sessionId}`;
        return tx`insert into outbox(topic,kind,version,payload) values(
          ${buildUserInboxTopic(fixture.actorId)},${kind},1,
          ${{ kind, ids: [fixture.actorId, target], entityVersion: 1 }}::jsonb
        ) returning txid::text as txid,seq`;
      });
      const row = rows[0];
      if (!row) throw new Error('Durable control row unavailable');
      const position = { txid: String(row.txid), seq: BigInt(row.seq) };
      positions.push(position);
      await waitForOutboxFinality(fixture.client, position.txid, {
        now: Date.now,
      });
      await notifyOutbox(fixture.client, position);
      return position;
    };
    const access = await control('access.revoked', round.id);
    await waitFor(() =>
      [fixture.runtime, replica].every(
        (runtime) =>
          encodeOutboxCursor(runtime.drain.cursor()) ===
          encodeOutboxCursor(access),
      ),
    );
    await waitFor(
      () =>
        sockets.length === 2 &&
        sockets.every(
          (socket) => !socket.data.connection?.topics.has(round.topic),
        ),
    );
    assert({
      given:
        'an atomic durable membership removal and access control row with two independent native listeners/drains',
      should:
        'remove the private subscription on both instances without delivering inbox controls as events',
      actual: {
        removed: sockets.map(
          (socket) => !socket.data.connection?.topics.has(round.topic),
        ),
        events: peers.map(
          (peer) =>
            peer.frames.filter((frame) => frame.type === 'event').length,
        ),
      },
      expected: { removed: [true, true], events: [0, 0] },
    });
    await control('session.revoked', fixture.sessionId);
    assert({
      given: 'the same durable session deleted atomically with its control row',
      should: 'close both actual instances revoked without a periodic timer',
      actual: {
        codes: await Promise.all(peers.map((peer) => peer.closed)),
        events: peers.map(
          (peer) =>
            peer.frames.filter((frame) => frame.type === 'event').length,
        ),
      },
      expected: { codes: [4002, 4002], events: [0, 0] },
    });
  } finally {
    await replica?.close();
    await replicaResources?.close();
    await fixture.runtime.close();
    for (const row of positions)
      await fixture.client`delete from outbox where txid=${row.txid}::xid8 and seq=${row.seq}`;
    await rounds.close();
    await fixture.close();
  }
});

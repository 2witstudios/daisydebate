import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SocketData } from '../src/socket';
import {
  socketAuthorityFixture,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { openAuthorityPeer } from './authority-peer.test-support';
import { roundAudienceFixture } from './round-audience.test-support';
import { observeNativeServe } from './paused-reader.test-support';
import { waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

test('actual periodic topic batch removes silent revoked membership while preserving current subscriptions', async () => {
  const sockets: Bun.ServerWebSocket<SocketData>[] = [];
  const fixture = await socketAuthorityFixture(
    observeNativeServe((socket) => sockets.push(socket)),
  );
  const rounds = roundAudienceFixture(fixture.client, fixture.actorId);
  try {
    const removed = await rounds.seed('private', 'affirmative');
    const retained = await rounds.seed('private', 'judge');
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Actual authority listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket(fixture),
    );
    for (const [index, topic] of [
      removed.topic,
      retained.topic,
      'standings:current',
    ].entries())
      await peer.subscribe(topic, `periodic-${index}`);
    await fixture.client.begin(async (tx) => {
      await tx`delete from round_participants where round_id=${removed.id} and actor_id=${fixture.actorId}`;
      await tx`update rounds set version=version+1 where id=${removed.id}`;
    });
    fixture.advanceToRevalidation();
    await waitFor(
      () =>
        sockets.length === 1 &&
        !sockets[0]?.data.connection?.topics.has(removed.topic),
    );
    assert({
      given:
        'three real native subscriptions and a persisted private membership removed without any outbox event',
      should:
        'batch reauthorize by the actual 50s timer inside the accepted 60s bound and retain only current authority',
      actual: {
        removed: sockets[0]?.data.connection?.topics.has(removed.topic),
        retained: sockets[0]?.data.connection?.topics.has(retained.topic),
        standings: sockets[0]?.data.connection?.topics.has('standings:current'),
        open: peer.socket.readyState === WebSocket.OPEN,
        events: peer.frames.filter((frame) => frame.type === 'event').length,
      },
      expected: {
        removed: false,
        retained: true,
        standings: true,
        open: true,
        events: 0,
      },
    });
  } finally {
    await fixture.runtime.close();
    await rounds.close();
    await fixture.close();
  }
});

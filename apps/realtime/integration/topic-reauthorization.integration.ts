import { requireTestServices } from '@daisy/config';
import { sideSeat, judgeSeat } from '@daisy/protocol/seats';
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
    const removed = await rounds.seed('private', judgeSeat());
    const retained = await rounds.seed('private', sideSeat('affirmative'));
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Actual authority listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket(fixture),
    );
    const topics = [removed.topic, retained.topic, 'standings:current'];
    const acknowledgements: string[] = [];
    for (const [index, topic] of topics.entries())
      acknowledgements.push(
        (await peer.subscribe(topic, `periodic-${index}`)).type,
      );
    assert({
      given:
        'three initial real native requests before silent membership removal',
      should:
        'establish every authorized native subscription before testing its revalidation',
      actual: {
        acknowledgements,
        attached: topics.map((topic) =>
          Boolean(sockets[0]?.data.connection?.topics.get(topic)?.attached),
        ),
      },
      expected: {
        acknowledgements: ['subscribed', 'subscribed', 'subscribed'],
        attached: [true, true, true],
      },
    });
    // Persist the actual guarded assignment transition without an outbox hint.
    await fixture.client.begin(async (tx) => {
      await rounds.unassignJudge(tx as typeof fixture.client, removed.id);
    });
    const [history] =
      await fixture.client`select count(*)::int count,bool_and(not public.daisy_round_participant_is_current(id)) retired from round_participants where round_id=${removed.id} and actor_id=${fixture.actorId}`;
    assert({
      given: 'a genuine judge unassignment',
      should:
        'retain the immutable identity while removing only its current authority',
      actual: [history!.count, history!.retired],
      expected: [1, true],
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

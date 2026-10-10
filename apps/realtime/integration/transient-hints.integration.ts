import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { systemId } from '@daisy/clock';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { messagingTestReading } from '@daisy/auth/testing';
import { buildChannelTopic } from '@daisy/protocol';
import type { SocketData } from '../src/socket';
import {
  issueAuthorityTicket,
  socketAuthorityFixture,
} from './socket-authority.test-support';
import { openAuthorityPeer } from './authority-peer.test-support';
import { observeNativeServe } from './paused-reader.test-support';
import { waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

const subscription = (
  sockets: readonly Bun.ServerWebSocket<SocketData>[],
  topic: string,
) => sockets[0]?.data.connection?.topics.get(topic);

test('actual restricted-role SQL hint listener publishes only to a current authenticated channel reader', async () => {
  const sockets: Bun.ServerWebSocket<SocketData>[] = [];
  const fixture = await socketAuthorityFixture(
    observeNativeServe((socket) => sockets.push(socket)),
    64,
    undefined,
    messagingTestReading,
  );
  let messaging:
    Awaited<ReturnType<typeof createMessagingTestFixture>> | undefined;
  const sessionId = systemId.next();
  try {
    messaging = await createMessagingTestFixture(fixture.client);
    await fixture.client`insert into session(id,user_id,token,expires_at)
      values(${sessionId},${messaging.userId},${randomBytes(32).toString('base64url')},'2026-10-09T01:00:00Z')`;
    const port = fixture.runtime.server.port;
    if (port === undefined) throw new Error('Actual hint listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket({
        ...fixture,
        sessionId,
        userId: messaging.userId,
        actorId: messaging.actorId,
      }),
    );
    const topic = buildChannelTopic(messaging.channelId);
    const reply = await peer.subscribe(topic, 'typing-reader');
    assert({
      given: 'real durable identity, accepted DM and isolated reading evidence',
      should: 'establish the actual native channel subscription before hints',
      actual: {
        reply: reply.type,
        attached: subscription(sockets, topic)?.attached,
      },
      expected: { reply: 'subscribed', attached: true },
    });
    const delivered = subscription(sockets, topic)?.delivered;
    const through = fixture.runtime.drain.cursor();
    // Adapter proof only: the MSG aggregate producer separately owns the
    // decision to emit this hint. This exercises the real fixed PG channel.
    const notify = () => fixture.client`select pg_notify('daisy_realtime_hints',
      ${JSON.stringify({ v: 1, type: 'typing_changed', topic })})`;
    await notify();
    await waitFor(() =>
      peer.frames.some((frame) => frame.type === 'typing_changed'),
    );
    assert({
      given: 'a real PG notification and restricted-role native runtime',
      should: 'publish one thin hint without changing durable delivery history',
      actual: {
        hints: peer.frames.filter((frame) => frame.type === 'typing_changed'),
        delivered: subscription(sockets, topic)?.delivered,
        through: fixture.runtime.drain.cursor(),
      },
      expected: {
        hints: [{ v: 1, type: 'typing_changed', topic }],
        delivered,
        through,
      },
    });
    await fixture.client`delete from session where id=${sessionId}`;
    await notify();
    await waitFor(() => !subscription(sockets, topic));
    assert({
      given: 'durable session revocation before a subsequent real hint',
      should: 'freshly deny and detach without a second native hint',
      actual: peer.frames.filter((frame) => frame.type === 'typing_changed')
        .length,
      expected: 1,
    });
  } finally {
    await fixture.runtime.close();
    await fixture.client`delete from session where id=${sessionId}`;
    await messaging?.cleanup();
    await fixture.close();
  }
});

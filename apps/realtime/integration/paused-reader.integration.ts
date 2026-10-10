import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@daisy/protocol';
import { encodeOutboxCursor } from '@daisy/db';
import type { SocketData } from '../src/socket';
import {
  socketAuthorityFixture,
  authenticatedAuthorityPeer,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import {
  observeNativeServe,
  pausedNativePeer,
  fillNativeBuffer,
} from './paused-reader.test-support';
import { waitFor, insertOutboxRow, notifyOutbox } from './support';

setupRitewayBun();
requireTestServices(process.env);

test('physical paused TCP reader closes4005 while a healthy real recipient progresses', async () => {
  const sockets: Bun.ServerWebSocket<SocketData>[] = [];
  const fixture = await socketAuthorityFixture(
    observeNativeServe((socket) => sockets.push(socket)),
  );
  const topic = 'standings:authority-proof';
  let position: { txid: string; seq: bigint } | undefined;
  let peer: Awaited<ReturnType<typeof pausedNativePeer>> | undefined;
  try {
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Native TCP proof port unavailable');
    peer = await pausedNativePeer(port);
    peer.send({
      v: ENVELOPE_VERSION,
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      ticket: await issueAuthorityTicket(fixture),
    });
    await waitFor(() => peer!.frames.some((frame) => frame.type === 'ready'));
    peer.send({ v: ENVELOPE_VERSION, type: 'subscribe', id: 'paused', topic });
    await waitFor(() =>
      peer!.frames.some((frame) => frame.type === 'subscribed'),
    );
    const healthy = await authenticatedAuthorityPeer(fixture);
    const native = sockets[0];
    if (!native) throw new Error('Actual paused server socket unavailable');
    peer.pause();
    const payload = {
      kind: 'standings.updated' as const,
      ids: [fixture.actorId],
      entityVersion: 1,
    };
    const pressureFrame: ServerMessage = {
      v: ENVELOPE_VERSION,
      type: 'event',
      topic,
      position: encodeOutboxCursor(fixture.runtime.drain.cursor()),
      payload,
    };
    // Transport-only pressure, never a second authority predicate or synthetic buffer.
    // The subsequent real durable row takes the actual authorization/drain/sink path.
    await fillNativeBuffer(native, pressureFrame);
    const physicalBuffered = native.getBufferedAmount();
    position = await insertOutboxRow(fixture.client, {
      topic,
      kind: payload.kind,
      version: 1,
      payload,
    });
    await notifyOutbox(fixture.client, position);
    await waitFor(() => native.data.connection?.closed === true);
    peer.resume();
    const closed = await peer.closed();
    await waitFor(() =>
      healthy.frames.some(
        (frame) =>
          frame.type === 'event' &&
          frame.position === encodeOutboxCursor(position!),
      ),
    );
    assert({
      given:
        'a real authenticated TCP reader paused beyond the measured soft bound and a healthy native recipient',
      should:
        'close only the paused reader4005 and deliver the real finalized invalidation to the healthy recipient',
      actual: {
        physicalBufferExceeded: physicalBuffered > 262_144,
        closeCode: closed,
        healthyEvents: healthy.frames.filter((frame) => frame.type === 'event')
          .length,
      },
      expected: {
        physicalBufferExceeded: true,
        closeCode: 4005,
        healthyEvents: 1,
      },
    });
  } finally {
    peer?.destroy();
    if (position)
      await fixture.client`delete from outbox where txid=${position.txid}::xid8 and seq=${position.seq}`;
    await fixture.close();
  }
});

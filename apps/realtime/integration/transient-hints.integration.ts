import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { observationRuntimeFixture } from './observation-runtime.test-support';
import { waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

type Frame = Record<string, unknown> & { readonly type: string };

test('actual restricted-role SQL hint listener reaches only a current permitted channel observer', async () => {
  const fixture = await observationRuntimeFixture();
  try {
    const peer = await fixture.connect();
    peer.observe('hints-a');
    await waitFor(() => peer.snapshots().length > 0, 8000);
    const topic = `channel:${fixture.messaging.channelId}`;
    // Adapter proof only: the MSG aggregate producer separately owns the
    // decision to emit this hint. This exercises the real fixed PG channel.
    const notify = () =>
      fixture.admin`select pg_notify('daisy_realtime_hints',
        ${JSON.stringify({ v: ENVELOPE_VERSION, type: 'typing_changed', topic })})`;
    const hints = () =>
      (peer.frames as Frame[]).filter(
        (frame) => frame.type === 'typing_changed',
      );
    await notify();
    await waitFor(() => hints().length > 0, 8000);
    assert({
      given:
        'a real PG notification and a native socket admitted under a current permit',
      should: 'deliver one thin lossy hint to the permitted observer',
      actual: hints(),
      expected: [{ v: ENVELOPE_VERSION, type: 'typing_changed', topic }],
    });
    // The durable session's revocation is fenced through the same validated
    // control channel production relays; the observing permit cannot outlive it.
    await fixture.admin`delete from session where id=${fixture.sessionId}`;
    await fixture.resources.redis.publishObservationControl({
      kind: 'session',
      actorId: fixture.messaging.actorId,
      sessionId: fixture.sessionId,
    });
    await waitFor(
      () =>
        (peer.frames as Frame[]).some(
          (frame) =>
            frame.type === 'observation.state' &&
            (frame.state === 'unavailable' || frame.state === 'denied'),
        ),
      8000,
    );
    // The socket's own canonical session read now refuses: the ping answers
    // with the documented revoked close instead of a pong.
    peer.ping();
    assert({
      given: 'a ping from a socket whose durable session is deleted',
      should: 'close the socket with the revoked close code',
      actual: await peer.closed,
      expected: 4002,
    });
    // No current permit and no socket: whatever the LISTEN callback's
    // arrival order, the fenced observer cannot receive another hint.
    await notify();
    assert({
      given:
        'a real hint after the durable session revocation fenced the observer',
      should: 'deliver no further hint without a current permit',
      actual: hints().length,
      expected: 1,
    });
  } finally {
    await fixture.close();
  }
}, 20_000);

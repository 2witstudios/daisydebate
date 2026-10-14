import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { request, sessionsFixture } from './observation-sessions.test-support';
setupRitewayBun();

const hint = {
  v: ENVELOPE_VERSION,
  type: 'typing_changed' as const,
  topic: `channel:${request.resource.id}`,
};
const principal = (session: string) => ({
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: session.repeat(24),
});
/** A socket that records every frame, hints included. */
function rawSocket(
  fixture: ReturnType<typeof sessionsFixture>,
  session: string,
) {
  const frames: unknown[] = [];
  const connection = fixture.sessions.connect(principal(session), {
    send: (frame) => frames.push(frame),
    sendText: (text) => frames.push(JSON.parse(text)),
  });
  return {
    connection,
    hints: () =>
      frames.filter(
        (frame) => (frame as { type: string }).type === 'typing_changed',
      ).length,
  };
}

test('a channel hint reaches each permitted observing socket once', async () => {
  const fixture = sessionsFixture();
  const permitted = rawSocket(fixture, 'p'),
    twoWindows = rawSocket(fixture, 'w'),
    pending = rawSocket(fixture, 'q'),
    elsewhere = rawSocket(fixture, 'e');
  permitted.connection.observe(request);
  twoWindows.connection.observe(request);
  twoWindows.connection.observe({
    ...request,
    id: 'request-2',
    window: { after: 10, limit: 50 },
  });
  elsewhere.connection.observe({
    ...request,
    resource: { kind: 'channel', id: 'd'.repeat(24) },
  });
  await fixture.flush();
  fixture.admits[0]!.resolve(
    fixture.admits[0]!.bindings.map(() => fixture.allowed()),
  );
  await fixture.flush();
  pending.connection.observe({ ...request, id: 'request-3' });
  await fixture.flush();
  const reads = () => fixture.admits.length + fixture.renews.length;
  const before = reads();
  for (let index = 0; index < 3; index++)
    fixture.sessions.hint(request.resource, hint);
  await fixture.flush();
  assert({
    given: 'three channel hints to several observing sockets',
    should: 'issue no authority read of their own',
    actual: reads() - before,
    expected: 0,
  });
  assert({
    given:
      'admitted sockets on the channel (one with two windows), one still pending and one on another channel',
    should:
      'send the hint once to each admitted socket and nothing to the others',
    actual: [
      permitted.hints() / 3,
      twoWindows.hints() / 3,
      pending.hints(),
      elsewhere.hints(),
    ],
    expected: [1, 1, 0, 0],
  });
});

test('a channel hint never outlives the observing permit', async () => {
  const fixture = sessionsFixture();
  const tab = rawSocket(fixture, 'p');
  tab.connection.observe(request);
  await fixture.flush();
  fixture.admits[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  fixture.advance(5000);
  fixture.sessions.hint(request.resource, hint);
  assert({
    given: 'an admitted socket whose permit evidence has expired',
    should: 'send no hint',
    actual: tab.hints(),
    expected: 0,
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  base,
  request,
  sessionsFixture,
  summary,
} from './observation-sessions.test-support';
setupRitewayBun();

test('identical session observers coalesce one admission and node key', async () => {
  const fixture = sessionsFixture();
  const first = fixture.socket(),
    second = fixture.socket();
  first.connection.observe(request);
  second.connection.observe({ ...request, id: 'request-2' });
  await fixture.flush();
  const batch = fixture.admits.map((read) => read.bindings.length);
  fixture.admits[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  fixture.snapshot(2);
  await fixture.flush();
  assert({
    given: 'two tabs of one session observing the same channel window',
    should:
      'admit one coalesced binding, send ready before the shared baseline and share one node key',
    actual: {
      batch,
      first: summary(first.frames),
      second: summary(second.frames),
      stats: fixture.node.stats().keys,
      bindings: fixture.sessions.stats().bindings,
    },
    expected: {
      batch: [1],
      first: ['ready:1', 'snapshot:1:2'],
      second: ['ready:1', 'snapshot:1:2'],
      stats: 1,
      bindings: 1,
    },
  });
});

test('denial and unavailability resolve the subscription without a node binding', async () => {
  const fixture = sessionsFixture();
  const denied = fixture.socket('d'.repeat(24)),
    unavailable = fixture.socket('e'.repeat(24));
  denied.connection.observe(request);
  unavailable.connection.observe(request);
  await fixture.flush();
  fixture.admits[0]!.resolve([{ status: 'denied' }, { status: 'unavailable' }]);
  await fixture.flush();
  fixture.advance(1000);
  fixture.sessions.renewDue();
  await fixture.flush();
  const retried = fixture.admits.length;
  fixture.admits[1]!.resolve([fixture.allowed()]);
  await fixture.flush();
  assert({
    given: 'a denied and an infrastructure-unavailable admission',
    should:
      'end the denied binding, retry the unavailable one without another event and then admit it',
    actual: {
      denied: summary(denied.frames),
      unavailable: summary(unavailable.frames),
      retried,
      bindings: fixture.sessions.stats().bindings,
    },
    expected: {
      denied: ['state:denied'],
      unavailable: ['state:unavailable', 'ready:1'],
      retried: 2,
      bindings: 1,
    },
  });
});

test('renewal refreshes validity without rebinding and denial removes delivery', async () => {
  const fixture = sessionsFixture();
  const tab = await fixture.admitted();
  fixture.advance(1500);
  fixture.sessions.renewDue();
  const early = fixture.renews.length;
  fixture.advance(1000);
  fixture.sessions.renewDue();
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  const renewedValidity = tab.frames.at(-1)?.validForMs;
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[1]!.resolve([{ status: 'denied' }]);
  await fixture.flush();
  fixture.snapshot(5);
  await fixture.flush();
  assert({
    given: 'a permit approaching expiry, one renewal and then a revocation',
    should:
      'renew once per due binding, keep the generation, then deny and stop all snapshots',
    actual: {
      early,
      frames: summary(tab.frames),
      renewedValidity,
      bindings: fixture.node.stats().bindings,
    },
    expected: {
      early: 0,
      frames: ['ready:1', 'ready:1', 'state:denied'],
      renewedValidity: 4700,
      bindings: 0,
    },
  });
});

test('an observed control fences delivery immediately until fresh admission', async () => {
  const fixture = sessionsFixture();
  const tab = await fixture.admitted();
  fixture.snapshot(2);
  await fixture.flush();
  fixture.sessions.revokeSession('a'.repeat(24), 'x'.repeat(24));
  fixture.sessions.revokeSession('a'.repeat(24), 's'.repeat(24));
  fixture.snapshot(3);
  await fixture.flush();
  const fenced = summary(tab.frames);
  fixture.admits[1]!.resolve([fixture.allowed(base(2))]);
  await fixture.flush();
  fixture.snapshot(4, base(2));
  await fixture.flush();
  assert({
    given:
      'another session revoked, then this session revoked during delivery, then a new disclosure base',
    should:
      'hide and fence the old permit, then rebind with a new generation and the new base',
    actual: { fenced, final: summary(tab.frames).slice(fenced.length) },
    expected: {
      fenced: ['ready:1', 'snapshot:1:2', 'state:unavailable'],
      final: ['ready:2', 'snapshot:2:4'],
    },
  });
});

test('aged admission, capacity and disposal never deliver late results', async () => {
  const fixture = sessionsFixture({ maxPerSession: 1 });
  const first = fixture.socket('f'.repeat(24)),
    aged = fixture.socket('g'.repeat(24));
  first.connection.observe(request);
  first.connection.observe({
    ...request,
    id: 'over',
    resource: { kind: 'room', id: 'r'.repeat(24) },
  });
  await fixture.flush();
  aged.connection.observe(request);
  fixture.advance(300);
  first.connection.close();
  fixture.admits[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  assert({
    given:
      'a per-socket capacity refusal, a request aged past its queue budget and a socket closed mid-admission',
    should:
      'refuse over capacity, settle the aged request unavailable without reading it and drop the late grant',
    actual: {
      first: summary(first.frames),
      aged: summary(aged.frames),
      reads: fixture.admits.map((read) => read.bindings.length),
      bindings: fixture.node.stats().bindings,
    },
    expected: {
      first: ['state:unavailable'],
      aged: ['state:unavailable'],
      reads: [1],
      bindings: 0,
    },
  });
});

test('a renewal read in flight across a control cannot restore delivery', async () => {
  const fixture = sessionsFixture();
  const tab = await fixture.admitted();
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.sessions.revokeSession('a'.repeat(24), null);
  fixture.renews[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  fixture.snapshot(2);
  await fixture.flush();
  assert({
    given: 'a renewal that read facts before an observed revocation control',
    should: 'refuse its grant and deliver nothing until a fresh admission',
    actual: {
      frames: summary(tab.frames).filter(
        (frame) => frame !== 'state:unavailable',
      ),
      bindings: fixture.node.stats().bindings,
    },
    expected: { frames: ['ready:1'], bindings: 0 },
  });
});

test('a session control fences only that session until fresh admission', async () => {
  const fixture = sessionsFixture();
  const revoked = fixture.socket('r'.repeat(24)),
    other = fixture.socket('o'.repeat(24));
  revoked.connection.observe(request);
  other.connection.observe(request);
  await fixture.flush();
  fixture.admits[0]!.resolve([fixture.allowed(), fixture.allowed()]);
  await fixture.flush();
  fixture.sessions.revokeSession('a'.repeat(24), 'r'.repeat(24));
  fixture.snapshot(2);
  await fixture.flush();
  fixture.admits[1]!.resolve([{ status: 'denied' }]);
  await fixture.flush();
  assert({
    given: 'a durable revocation of one of two sessions of the same actor',
    should: 'hide and deny the revoked session while the other keeps delivery',
    actual: { revoked: summary(revoked.frames), other: summary(other.frames) },
    expected: {
      revoked: ['ready:1', 'state:unavailable', 'state:denied'],
      other: ['ready:1', 'snapshot:1:2'],
    },
  });
});

test('a session control during an in-flight admission refuses its grant', async () => {
  const fixture = sessionsFixture();
  const tab = fixture.socket();
  tab.connection.observe(request);
  await fixture.flush();
  fixture.sessions.revokeSession('a'.repeat(24), 's'.repeat(24));
  fixture.admits[0]!.resolve([fixture.allowed()]);
  await fixture.flush();
  fixture.snapshot(2);
  await fixture.flush();
  assert({
    given:
      'session.revoked arriving while the first canonical admission is pending',
    should: 'install nothing from the stale read and await a fresh admission',
    actual: {
      delivered: summary(tab.frames).filter(
        (frame) => frame !== 'state:unavailable',
      ),
      readmissions: fixture.admits.length,
      bindings: fixture.node.stats().bindings,
    },
    expected: { delivered: [], readmissions: 2, bindings: 0 },
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  base,
  request,
  sessionsFixture,
} from './observation-sessions.test-support';
setupRitewayBun();
const dependencies = [{ key: 'account-x', revision: '1' }];

test('actor overlays travel with ready and refresh only from canonical reads', async () => {
  const fixture = sessionsFixture();
  const tab = fixture.socket(),
    oversized = fixture.socket('z'.repeat(24));
  tab.connection.observe(request);
  oversized.connection.observe(request);
  await fixture.flush();
  // The tab's canonical overlay beside an oversized one for the other session.
  const pair = (own: string) => [
    fixture.allowed(base(), dependencies, { own: [own] }),
    fixture.allowed(base(), dependencies, { text: 'x'.repeat(70_000) }),
  ];
  fixture.admits[0]!.resolve(pair('first'));
  await fixture.flush();
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[0]!.resolve(pair('first'));
  await fixture.flush();
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[1]!.resolve(pair('second'));
  await fixture.flush();
  assert({
    given:
      'an admitted overlay, a renewal with the same overlay, one with a changed overlay, and an oversized one',
    should:
      'send an overlay only when it changes and drop an unbounded one without making delivery unavailable',
    actual: {
      overlays: tab.frames
        .filter((frame) => frame.type === 'observation.ready')
        .map((frame) => frame.overlay),
      oversized: oversized.frames.map((frame) => [frame.type, frame.overlay]),
    },
    expected: {
      overlays: [{ own: ['first'] }, undefined, { own: ['second'] }],
      oversized: [
        ['observation.ready', undefined],
        ['observation.ready', undefined],
        ['observation.ready', undefined],
      ],
    },
  });
});

test('closing the runtime tells every current observer delivery is unavailable', async () => {
  const fixture = sessionsFixture();
  const tab = await fixture.admitted();
  fixture.sessions.close();
  fixture.snapshot(2);
  await fixture.flush();
  assert({
    given: 'an admitted observer when the runtime fails closed',
    should: 'report unavailable and deliver nothing afterwards',
    actual: tab.frames.map((frame) => frame.type).slice(1),
    expected: ['observation.state'],
  });
});

test('retained overlays stay within the node budget', async () => {
  const fixture = sessionsFixture({ overlayBudgetBytes: 100 });
  const first = fixture.socket('f'.repeat(24)),
    second = fixture.socket('g'.repeat(24));
  first.connection.observe(request);
  second.connection.observe(request);
  await fixture.flush();
  fixture.admits[0]!.resolve([
    fixture.allowed(base(), dependencies, { own: ['a'.repeat(60)] }),
    fixture.allowed(base(), dependencies, { own: ['b'.repeat(60)] }),
  ]);
  await fixture.flush();
  assert({
    given: 'two overlays whose sum exceeds the node overlay budget',
    should: 'retain the first and degrade the second to none',
    actual: [first, second].map((tab) => tab.frames.at(-1)?.overlay),
    expected: [{ own: ['a'.repeat(60)] }, undefined],
  });
});

test('a rebind resends the overlay and dropped bindings return their budget', async () => {
  const fixture = sessionsFixture({ overlayBudgetBytes: 100 });
  const overlay = { own: ['a'.repeat(60)] };
  const tab = fixture.socket();
  tab.connection.observe(request);
  await fixture.flush();
  fixture.admits[0]!.resolve([fixture.allowed(base(), dependencies, overlay)]);
  await fixture.flush();
  fixture.sessions.revokeSession('a'.repeat(24), null);
  await fixture.flush();
  fixture.admits[1]!.resolve([fixture.allowed(base(2), dependencies, overlay)]);
  await fixture.flush();
  const rebound = tab.frames
    .filter((frame) => frame.type === 'observation.ready')
    .map((frame) => [frame.generation, frame.overlay]);
  tab.connection.unobserve(request);
  const next = fixture.socket('n'.repeat(24));
  next.connection.observe(request);
  await fixture.flush();
  fixture.admits[2]!.resolve([fixture.allowed(base(), dependencies, overlay)]);
  await fixture.flush();
  assert({
    given:
      'an overlay, a fence and readmission onto a new base, then a released binding and a new one within the budget',
    should:
      'send the overlay for the new generation and admit the next overlay after the first binding returns its bytes',
    actual: { rebound, next: next.frames.at(-1)?.overlay },
    expected: {
      rebound: [
        [1, overlay],
        [2, overlay],
      ],
      next: overlay,
    },
  });
});

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
  fixture.admits[0]!.resolve([
    fixture.allowed(base(), dependencies, { own: ['first'] }),
    fixture.allowed(base(), dependencies, { text: 'x'.repeat(70_000) }),
  ]);
  await fixture.flush();
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[0]!.resolve([
    fixture.allowed(base(), dependencies, { own: ['first'] }),
    fixture.allowed(base(), dependencies, { text: 'x'.repeat(70_000) }),
  ]);
  await fixture.flush();
  fixture.advance(2500);
  fixture.sessions.renewDue();
  await fixture.flush();
  fixture.renews[1]!.resolve([
    fixture.allowed(base(), dependencies, { own: ['second'] }),
    fixture.allowed(base(), dependencies, { text: 'x'.repeat(70_000) }),
  ]);
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

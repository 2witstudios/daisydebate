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
    fixture.allowed(base(), dependencies, { own: ['second'] }),
  ]);
  await fixture.flush();
  assert({
    given:
      'an admitted overlay, a renewal with a changed overlay and an oversized one',
    should:
      'send each canonical overlay on ready and drop an unbounded one without making delivery unavailable',
    actual: {
      overlays: tab.frames
        .filter((frame) => frame.type === 'observation.ready')
        .map((frame) => frame.overlay),
      oversized: oversized.frames.map((frame) => [frame.type, frame.overlay]),
    },
    expected: {
      overlays: [{ own: ['first'] }, { own: ['second'] }],
      oversized: [['observation.ready', null]],
    },
  });
});

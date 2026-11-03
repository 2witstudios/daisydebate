import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subscribeBrowserPageEvents } from './browser-page-events';
import { createMediaHarness } from '../media-harness.test-support';
import {
  admission,
  snapshot,
  transportStub,
} from '../media-fixtures.test-support';

setupRitewayBun();

test('real online and visible events nudge once each, and a disposed lifetime hears nothing', () => {
  const online = new EventTarget(),
    visibility = new EventTarget();
  let visible = true,
    nudges = 0;
  const dispose = subscribeBrowserPageEvents({
    online,
    visibility,
    isVisible: () => visible,
    page: new EventTarget(),
    leaving: () => undefined,
    restored: () => undefined,
    nudge: () => void nudges++,
  });
  online.dispatchEvent(new Event('online'));
  visibility.dispatchEvent(new Event('visibilitychange'));
  visible = false;
  visibility.dispatchEvent(new Event('visibilitychange'));
  const whileMounted = nudges;
  dispose();
  online.dispatchEvent(new Event('online'));
  assert({
    given: 'online, visible and hidden events, then disposal and another event',
    should: 'nudge for online and visible only, and never after disposal',
    actual: [whileMounted, nudges],
    expected: [2, 2],
  });
});

test('leaving the page ends the media lifetime once, so its disconnect cannot request a new admission', async () => {
  const page = new EventTarget();
  let admits = 0;
  const controller = createMediaHarness({
    roundId: admission.roundId,
    initialRoundViewVersion: 1,
    api: {
      admit: async () => {
        admits++;
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
  });
  await controller.join();
  const dispose = subscribeBrowserPageEvents({
    online: new EventTarget(),
    visibility: new EventTarget(),
    isVisible: () => true,
    nudge: () => undefined,
    page,
    leaving: controller.stop,
    restored: () => undefined,
  });
  const frozen = Object.assign(new Event('pagehide'), { persisted: true });
  page.dispatchEvent(frozen);
  const afterFreeze = controller.state();
  page.dispatchEvent(new Event('pagehide'));
  const afterLeave = controller.state();
  await controller.reconnect();
  dispose();
  assert({
    given: 'a page frozen for back-forward restore, then one actually leaving',
    should:
      'keep the restorable lifetime, end the left one and admit nothing after it',
    actual: { afterFreeze, afterLeave, admits },
    expected: { afterFreeze: 'live', afterLeave: 'ended', admits: 1 },
  });
});

test('only a page restored from the back-forward cache asks for fresh state', () => {
  const page = new EventTarget();
  let restored = 0;
  const dispose = subscribeBrowserPageEvents({
    online: new EventTarget(),
    visibility: new EventTarget(),
    isVisible: () => true,
    nudge: () => undefined,
    page,
    leaving: () => undefined,
    restored: () => void restored++,
  });
  page.dispatchEvent(new Event('pageshow'));
  page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  dispose();
  page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  assert({
    given: 'a first load, a restore, then a restore after disposal',
    should: 'ask once, for the restore while mounted',
    actual: restored,
    expected: 1,
  });
});

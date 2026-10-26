import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTimerQueue } from './connection-store.test-support';
import { IDLE_AFTER_MS, startPresenceBeacon } from './presence-beacon';

setupRitewayBun();

const harness = () => {
  const scheduler = createTimerQueue((clock, ms) => clock + ms);
  const events: string[] = [];
  let visible = true;
  let visibility: ((visible: boolean) => void) | null = null;
  let input: (() => void) | null = null;
  const stop = startPresenceBeacon({
    connection: {
      connect: () => events.push('connect'),
      close: () => events.push('close'),
      reportActivity: (activity) => events.push(activity),
    },
    scheduler,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibility = listener;
      return () => {
        visibility = null;
      };
    },
    onInput: (listener) => {
      input = listener;
      return () => {
        input = null;
      };
    },
  });
  return {
    scheduler,
    events,
    stop,
    hide: () => {
      visible = false;
      visibility?.(false);
    },
    show: () => {
      visible = true;
      visibility?.(true);
    },
    input: () => input?.(),
    listening: () => visibility !== null || input !== null,
  };
};

test('a visible tab starts active and goes idle after five quiet minutes', () => {
  const h = harness();
  h.scheduler.advance(IDLE_AFTER_MS - 1);
  const before = [...h.events];
  h.scheduler.advance(1);
  assert({
    given: 'a visible tab with no input',
    should: 'connect and report active, then idle at five minutes',
    actual: [before, h.events.at(-1)],
    expected: [['connect', 'active'], 'idle'],
  });
});

test('input keeps a tab active and wakes an idle one', () => {
  const h = harness();
  h.scheduler.advance(IDLE_AFTER_MS / 2);
  h.input();
  h.scheduler.advance(IDLE_AFTER_MS / 2);
  const stillActive = h.events.at(-1);
  h.scheduler.advance(IDLE_AFTER_MS);
  const idle = h.events.at(-1);
  h.input();
  assert({
    given: 'input halfway, five more quiet minutes, then input again',
    should: 'stay active, go idle, then report active',
    actual: [stillActive, idle, h.events.at(-1)],
    expected: ['active', 'idle', 'active'],
  });
});

test('hiding the tab reports idle and showing it reports active', () => {
  const h = harness();
  h.hide();
  const hidden = h.events.at(-1);
  h.show();
  assert({
    given: 'the tab hidden and shown again',
    should: 'report idle, then active',
    actual: [hidden, h.events.at(-1)],
    expected: ['idle', 'active'],
  });
});

test('stop closes the connection and releases every listener', () => {
  const h = harness();
  h.stop();
  assert({
    given: 'a stopped beacon',
    should: 'close the connection and stop listening',
    actual: [h.events.at(-1), h.listening()],
    expected: ['close', false],
  });
});

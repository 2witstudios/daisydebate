import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTimerQueue } from './connection-store.test-support';
import { IDLE_AFTER_MS } from './presence-beacon';
import { createTabPresence, keepPresenceConnection } from './tab-presence';

setupRitewayBun();

const harness = () => {
  const scheduler = createTimerQueue((clock, ms) => clock + ms);
  let visibility: ((visible: boolean) => void) | null = null;
  let visible = true;
  const tab = createTabPresence({
    scheduler,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibility = listener;
      return () => {
        visibility = null;
      };
    },
    onInput: () => () => {},
  });
  const reporter = (name: string, log: string[]) => ({
    reportActivity: (activity: string) => log.push(`${name} ${activity}`),
  });
  return {
    tab,
    scheduler,
    reporter,
    hide: () => {
      visible = false;
      visibility?.(false);
    },
    beaconRunning: () => visibility !== null,
  };
};

test('every connection in a tab reports the one tab activity', () => {
  const h = harness();
  const log: string[] = [];
  const leaveShell = h.tab.attach(h.reporter('shell', log));
  h.tab.attach(h.reporter('conversation', log));
  h.hide();
  leaveShell();
  h.scheduler.advance(IDLE_AFTER_MS);
  assert({
    given: 'a shell and a conversation connection, then the tab hidden',
    should: 'start each active and send idle to both',
    actual: log,
    expected: [
      'shell active',
      'shell active',
      'conversation active',
      'shell idle',
      'conversation idle',
    ],
  });
});

test('the activity source runs only while a connection is attached', () => {
  const h = harness();
  const detach = h.tab.attach(h.reporter('page', []));
  const running = h.beaconRunning();
  detach();
  detach();
  assert({
    given: 'one connection attached, then detached twice',
    should: 'run the source while attached and stop it after',
    actual: [running, h.beaconRunning(), h.tab.size()],
    expected: [true, false, 0],
  });
});

test('keepPresenceConnection opens the shell socket only when the tab has none', () => {
  const h = harness();
  const events: string[] = [];
  const stop = keepPresenceConnection(h.tab, () => {
    const store = {
      reportActivity: () => {},
      connect: () => events.push('shell open'),
      close: () => {
        events.push('shell closed');
        detachShell();
      },
    };
    const detachShell = h.tab.attach(store);
    return store;
  });
  const leavePage = h.tab.attach(h.reporter('page', []));
  leavePage();
  stop();
  assert({
    given:
      'a tab alone, then a page with its own socket, then the page leaving',
    should:
      'open the shell socket, close it for the page, reopen it after, and close it on stop',
    actual: events,
    expected: ['shell open', 'shell closed', 'shell open', 'shell closed'],
  });
});

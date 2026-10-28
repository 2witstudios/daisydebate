import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSubscriptionRequests } from './subscription-requests';

setupRitewayBun();

/** One fake publication and timer queue. */
const fixture = () => {
  const asks: boolean[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const publication = {
    sid: 'TR_mic',
    subscribed: false,
    setSubscribed: (subscribed: boolean) => {
      asks.push(subscribed);
    },
  };
  const requests = createSubscriptionRequests({
    set: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clear: (handle) => {
      (handle as (typeof timers)[number]).cleared = true;
    },
  });
  return { asks, timers, publication, requests };
};

test('a pending subscription is asked for once, and withdrawn once', () => {
  const { asks, publication, requests } = fixture();
  requests.reconcile(publication, true);
  requests.reconcile(publication, true);
  requests.reconcile(publication, false);
  requests.reconcile(publication, false);
  assert({
    given:
      'a wanted publication reconciled twice before its track arrives, then unwanted twice',
    should: 'ask once and withdraw once',
    actual: asks,
    expected: [true, false],
  });
});

test('a refused subscription is asked again after a pause doubling to 30 s, until it arrives', () => {
  const { asks, timers, publication, requests } = fixture();
  const retry = () => requests.reconcile(publication, true);
  requests.reconcile(publication, true);
  for (let failure = 0; failure < 7; failure++) {
    requests.failed('TR_mic', retry);
    timers.at(-1)!.run();
  }
  requests.failed('TR_mic', retry);
  requests.subscribed('TR_mic');
  assert({
    given: 'eight refusals of one wanted microphone, then its track arriving',
    should:
      'ask again after each pause (1, 2, 4, 8, 16, 30, 30 s), and cancel the pending retry once it arrives',
    actual: {
      asks: asks.length,
      pauses: timers.map((timer) => timer.ms),
      lastCleared: timers.at(-1)!.cleared,
    },
    expected: {
      asks: 8,
      pauses: [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000],
      lastCleared: true,
    },
  });
});

test('closing cancels every pending retry; an ended track is asked for again', () => {
  const { asks, timers, publication, requests } = fixture();
  requests.reconcile(publication, true);
  requests.failed('TR_mic', () => undefined);
  requests.close();
  requests.reconcile(publication, true);
  requests.ended('TR_mic');
  requests.reconcile(publication, true);
  assert({
    given:
      'a refused ask, a close, then a fresh ask, an ended track and a want',
    should: 'cancel the retry and ask again after the track ended',
    actual: { cleared: timers[0]!.cleared, asks },
    expected: { cleared: true, asks: [true, true, true] },
  });
});

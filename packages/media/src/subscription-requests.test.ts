import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createSubscriptionRequests,
  livePublication,
} from './subscription-requests';

setupRitewayBun();

/** One fake publication and a queue of timers the test fires by hand. */
const fixture = () => {
  const asks: boolean[] = [];
  const timers: { run: () => void; ms: number; done: boolean }[] = [];
  const publication = {
    sid: 'TR_mic',
    subscribed: false,
    setSubscribed: (subscribed: boolean) => {
      asks.push(subscribed);
    },
  };
  const requests = createSubscriptionRequests({
    set: (run, ms) => {
      const timer = {
        ms,
        done: false,
        run: () => {
          timer.done = true;
          run();
        },
      };
      timers.push(timer);
      return timer;
    },
    clear: (handle) => {
      (handle as (typeof timers)[number]).done = true;
    },
  });
  const want = (wanted = true) =>
    requests.reconcile(publication, wanted, () => want());
  /** Timers still armed (neither fired nor cleared), by delay. */
  const live = () =>
    timers.filter((timer) => !timer.done).map((timer) => timer.ms);
  return { asks, timers, publication, requests, want, live };
};

test('a pending subscription is asked for once, and withdrawn once', () => {
  const { asks, want, live } = fixture();
  want();
  want();
  want(false);
  want(false);
  assert({
    given:
      'a wanted publication reconciled twice before its track arrives, then unwanted twice',
    should: 'ask once, withdraw once, and leave no timer armed',
    actual: { asks, live: live() },
    expected: { asks: [true, false], live: [] },
  });
});

test('a refused subscription is asked again after a pause doubling to 30 s, until it arrives', () => {
  const { asks, timers, requests, want, live } = fixture();
  want();
  for (let refusal = 0; refusal < 7; refusal++) {
    requests.retry('TR_mic', () => want());
    timers.at(-1)!.run();
  }
  requests.subscribed('TR_mic');
  assert({
    given: 'seven refusals of one wanted microphone, then its track arriving',
    should:
      'ask again after each pause (1, 2, 4, 8, 16, 30, 30 s), and leave no timer once it arrives',
    actual: {
      asks: asks.length,
      pauses: timers
        .filter((timer) => timer.ms !== 10000)
        .map((timer) => timer.ms),
      live: live(),
    },
    expected: {
      asks: 8,
      pauses: [1000, 2000, 4000, 8000, 16000, 30000, 30000],
      live: [],
    },
  });
});

test('an ask nothing answers times out and is asked again', () => {
  const { asks, timers, want } = fixture();
  want();
  timers[0]!.run();
  timers[1]!.run();
  assert({
    given: 'an ask with neither its track nor a refusal within 10 s',
    should: 'count it refused and ask again after the first pause',
    actual: { asks, delays: timers.map((timer) => timer.ms) },
    expected: { asks: [true, true], delays: [10000, 1000, 10000] },
  });
});

test('a withdrawal, an unpublished track or a close cancels a pending retry', () => {
  const withdrawn = fixture();
  withdrawn.want();
  withdrawn.requests.retry('TR_mic', () => withdrawn.want());
  withdrawn.want(false);
  const unpublished = fixture();
  unpublished.want();
  unpublished.requests.retry('TR_mic', () => unpublished.want());
  unpublished.requests.ended('TR_mic');
  const closed = fixture();
  closed.want();
  closed.requests.close();
  closed.requests.retry('TR_mic', () => closed.want());
  closed.want();
  assert({
    given:
      'a refused ask then withdrawn, one then unpublished, and a close followed by a late refusal and a want',
    should: 'leave no timer armed and ask nothing after the close',
    actual: [
      withdrawn.live(),
      unpublished.live(),
      { live: closed.live(), asks: closed.asks },
    ],
    expected: [[], [], { live: [], asks: [true] }],
  });
});

test('a failed SDK re-attempt, with no ask of ours outstanding, is asked again', () => {
  const { asks, timers, requests, want } = fixture();
  requests.retry('TR_mic', () => want());
  timers[0]!.run();
  assert({
    given: 'a subscription failure for a sid with no outstanding ask',
    should: 'ask again after the first pause',
    actual: { first: timers[0]!.ms, asks },
    expected: { first: 1000, asks: [true] },
  });
});

test('a held track the SFU keeps dropping is asked again after a pause that grows across arrivals', () => {
  const { timers, publication, requests, want } = fixture();
  const arrive = () => {
    publication.subscribed = true;
    requests.subscribed('TR_mic');
  };
  const drop = () => {
    publication.subscribed = false;
    requests.retry('TR_mic', () => want());
  };
  want();
  for (let flap = 0; flap < 3; flap++) {
    arrive();
    drop();
    timers.at(-1)!.run();
  }
  assert({
    given: 'a microphone that arrives and is dropped three times',
    should: 'ask again after 1 s, 2 s, then 4 s, never at once',
    actual: timers
      .filter((timer) => timer.ms !== 10000)
      .map((timer) => timer.ms),
    expected: [1000, 2000, 4000],
  });
});

test('a retry finds a publication only on the participant still in the room', () => {
  const publication = { sid: 'TR_mic' };
  const present = {
    identity: 'peer',
    trackPublications: new Map([['TR_mic', publication]]),
  };
  const departed = { ...present };
  const inRoom = new Map([['peer', present]]);
  assert({
    given:
      'the present participant, and a departed one under the same identity',
    should: 'return the live publication, and nothing for the departed one',
    actual: [
      livePublication(inRoom, present, 'TR_mic'),
      livePublication(inRoom, departed, 'TR_mic'),
      livePublication(inRoom, present, 'TR_gone'),
    ],
    expected: [publication, undefined, undefined],
  });
});

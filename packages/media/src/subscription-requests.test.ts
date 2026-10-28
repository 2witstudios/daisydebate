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
  /** The track arrives, then (`drop`) the SFU drops it while still published. */
  const arrive = () => {
    publication.subscribed = true;
    requests.subscribed('TR_mic');
  };
  const drop = () => {
    publication.subscribed = false;
    requests.retry('TR_mic', () => want());
  };
  /** Asks, then `times` arrivals each dropped and asked again after its pause; the pauses waited. */
  const flap = (times: number) => {
    const waited: number[] = [];
    want();
    for (let round = 0; round < times; round++) {
      arrive();
      drop();
      waited.push(timers.at(-1)!.ms);
      timers.at(-1)!.run();
    }
    return waited;
  };
  return {
    asks,
    timers,
    publication,
    requests,
    want,
    live,
    arrive,
    drop,
    flap,
  };
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
  const pauses: number[] = [];
  for (let refusal = 0; refusal < 7; refusal++) {
    requests.retry('TR_mic', () => want());
    pauses.push(timers.at(-1)!.ms);
    timers.at(-1)!.run();
  }
  requests.subscribed('TR_mic');
  assert({
    given: 'seven refusals of one wanted microphone, then its track arriving',
    should:
      'ask again after each pause (1, 2, 4, 8, 16, 30, 30 s); once it arrives, only the hold that forgets its pause stays armed',
    actual: { asks: asks.length, pauses, live: live() },
    expected: {
      asks: 8,
      pauses: [1000, 2000, 4000, 8000, 16000, 30000, 30000],
      live: [30000],
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
  const { flap } = fixture();
  assert({
    given:
      'a microphone that arrives, holds less than 30 s and is dropped, three times',
    should:
      'ask again after 1 s, 2 s, then 4 s, never at once and never reset by a short hold',
    actual: flap(3),
    expected: [1000, 2000, 4000],
  });
});

test('an unsubscription asks again only for a still-wanted track', () => {
  const dropped = fixture();
  dropped.want();
  dropped.arrive();
  dropped.requests.unsubscribed('TR_mic', true, () => dropped.want());
  const withdrawn = fixture();
  withdrawn.want();
  withdrawn.arrive();
  withdrawn.want(false);
  withdrawn.requests.unsubscribed('TR_mic', false, () => withdrawn.want());
  assert({
    given:
      'a held track the SFU dropped while still wanted, and one we withdrew ourselves',
    should: 'arm a 1 s retry for the first and nothing for the second',
    actual: [dropped.live(), withdrawn.live()],
    expected: [[1000], []],
  });
});

test('a track that has held for 30 s starts again from the first pause', () => {
  const { timers, arrive, drop, flap } = fixture();
  flap(3);
  arrive();
  timers.at(-1)!.run();
  drop();
  assert({
    given:
      'a microphone that flapped three times, then held for 30 s and dropped',
    should: 'ask again after 1 s, not the grown pause',
    actual: { hold: timers.at(-2)!.ms, retry: timers.at(-1)!.ms },
    expected: { hold: 30000, retry: 1000 },
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

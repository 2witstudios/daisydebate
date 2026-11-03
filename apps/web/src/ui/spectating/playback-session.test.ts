import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseProductEvent, type ProductEvent } from '../../features/analytics/events';
import { watchPlayback } from './playback-session';

setupRitewayBun();

const session = () => {
  const element = Object.assign(new EventTarget(), { videoHeight: 720 });
  const page = new EventTarget();
  const sent: ProductEvent[] = [];
  let ms = 0;
  let ended = 0;
  const stop = watchPlayback({
    element,
    page,
    engine: 'native',
    surface: () => 'broadcast_playback',
    nowMs: () => ms,
    report: (event) => sent.push(event),
    onEnded: () => {
      ended += 1;
    },
  });
  const fire = (name: string, atMs: number) => {
    ms = atMs;
    element.dispatchEvent(new Event(name));
  };
  return { element, page, sent, fire, stop, ended: () => ended };
};

describe('watchPlayback', () => {
  test('the player reports one viewing when the page leaves', () => {
    const { page, sent, fire } = session();
    fire('play', 100);
    fire('playing', 600);
    fire('resize', 700);
    fire('waiting', 1_600);
    fire('playing', 1_900);
    fire('pause', 2_900);
    page.dispatchEvent(new Event('pagehide'));
    page.dispatchEvent(new Event('pagehide'));
    assert({
      given: 'a viewing that started, stalled and paused, then a page leaving',
      should: 'send its startup, rebuffering, watch time and height, once',
      actual: sent,
      expected: [
        {
          event: 'broadcast_playback',
          properties: {
            engine: 'native',
            startup_ms: 500,
            rebuffer_ms: 300,
            watched_ms: 2_000,
            height: 720,
          },
        },
      ],
    });
    const [first] = sent;
    assert({
      given: 'the event the player sent',
      should: 'pass the analytics schema, which allows no identity',
      actual: first && parseProductEvent(first.event, first.properties),
      expected: first,
    });
  });

  test('nothing is reported of what never played, or twice on the way out', () => {
    const idle = session();
    idle.fire('play', 0);
    idle.stop();
    assert({
      given: 'a player removed before its first frame',
      should: 'send nothing',
      actual: idle.sent,
      expected: [],
    });
    const played = session();
    played.fire('playing', 0);
    played.page.dispatchEvent(new Event('pagehide'));
    played.stop();
    played.page.dispatchEvent(new Event('pagehide'));
    played.fire('playing', 10);
    assert({
      given: 'a page leaving, then the player going, then later events',
      should: 'send one event and stop listening',
      actual: played.sent.length,
      expected: 1,
    });
  });

  test('the end of the video reaches the page', () => {
    const { fire, ended } = session();
    fire('ended', 0);
    assert({
      given: 'the video ending',
      should: 'tell the page',
      actual: ended(),
      expected: 1,
    });
  });
});

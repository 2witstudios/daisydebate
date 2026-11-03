import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StreamThisRound } from './stream-this-round';

setupRitewayBun();

const feedUrl = 'https://public.example/live/b1/master.m3u8';
const render = (mode: 'ranked' | 'casual') =>
  renderToString(h(StreamThisRound, { feedUrl, mode }));

describe('StreamThisRound', () => {
  test('the feed and the steps work with no script', () => {
    const html = render('casual');
    assert({
      given: 'a server render',
      should:
        'show the feed in a field to copy by hand, name OBS settings, and offer no dead Copy button',
      actual: [
        html.includes('Stream this Round'),
        html.includes(`value="${feedUrl}"`),
        html.includes('readOnly') || html.includes('readonly'),
        html.includes('Media Source'),
        html.includes('Local File'),
        html.includes('>Copy<'),
      ],
      expected: [true, true, true, true, true, false],
    });
  });

  test('no stream key, and nothing that looks like one-click push', () => {
    const text = render('ranked').toLowerCase();
    assert({
      given: 'the panel',
      should: 'say no key is needed, and never offer a push to a platform',
      actual: [
        text.includes('no stream key'),
        text.includes('twitch'),
        text.includes('youtube'),
      ],
      expected: [true, false, false],
    });
  });

  test('a ranked Round says integrity and links the rule', () => {
    const ranked = render('ranked');
    const casual = render('casual');
    assert({
      given: 'a ranked Round and a casual one',
      should:
        'give ranked the content policy link and integrity as the only reason, and neither to casual',
      actual: [
        ranked.includes('href="/content-policy"'),
        ranked.includes('integrity'),
        /betting|cheat|coach/i.test(ranked),
        casual.includes('/content-policy'),
        casual.includes('integrity'),
      ],
      expected: [true, true, false, false, false],
    });
  });
});

import { createElement as h } from 'react';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StreamThisRound } from './stream-this-round';

setupRitewayBun();

const feedUrl = 'https://public.example/live/b1/master.m3u8';
const render = (mode: 'ranked' | 'casual') =>
  renderAccessible(h(StreamThisRound, { feedUrl, mode })).within(
    'region',
    'Stream this Round',
  );

describe('StreamThisRound', () => {
  test('the feed and the steps work before hydration', () => {
    const view = render('casual');
    const feed = view.get('textbox', 'Official feed URL') as HTMLInputElement;
    const steps = view
      .within('list')
      .all('listitem')
      .map((step) => step.textContent);
    assert({
      given: 'a server render',
      should:
        'show the feed in a field to copy by hand, name OBS settings, and offer no dead Copy button',
      actual: [
        view.textContent().includes('Stream this Round'),
        feed.value,
        feed.readOnly,
        steps.some((step) =>
          step?.includes('then Media (Media Source in older versions)'),
        ),
        steps.some((step) => step?.includes('Local File')),
        view.has('button', 'Copy'),
      ],
      expected: [true, feedUrl, true, true, true, false],
    });
  });

  test('the steps say what OBS does at a break and at the end', () => {
    const text = render('casual').textContent();
    assert({
      given: 'behaviour measured on OBS 32.1.2',
      should:
        'tell a streamer how to clear a jumping picture and how the end looks',
      actual: [
        text.includes('delete the source and add it again'),
        text.includes('about two minutes'),
      ],
      expected: [true, true],
    });
  });

  test('no stream key, and nothing that looks like one-click push', () => {
    const text = render('ranked').textContent().toLowerCase();
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
        ranked.attribute('link', 'ranked content policy', 'href'),
        ranked.textContent().includes('integrity'),
        /betting|cheat|coach/i.test(ranked.textContent()),
        casual.count('link'),
        casual.textContent().includes('integrity'),
      ],
      expected: ['/content-policy', true, false, 0, false],
    });
  });
});

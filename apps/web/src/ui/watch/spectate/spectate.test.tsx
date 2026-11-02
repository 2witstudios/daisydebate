import { sampleWatchSource } from '../../../features/watch/sample-source.test-support';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/sample-source.test-support';
import { openSpectate } from '../../../features/watch/open-spectate';
import {
  defaultSpectateQuery,
  type SpectateQuery,
} from '../../../features/watch/spectate-query';
import type { SpectateView } from '../../../features/watch/spectate-view';
import { Spectate } from './spectate';

setupRitewayBun();

const view = (
  id: string,
  query: SpectateQuery = defaultSpectateQuery,
): SpectateView => {
  const screen = openSpectate(id, watchViewer(true), query, sampleWatchSource);
  if (screen.kind !== 'watch') throw new Error('not watchable');
  return screen.view;
};
const render = (v: SpectateView) => renderToString(h(Spectate, { view: v }));

describe('Spectate: live', () => {
  const html = render(view('top-of-the-ladder'));

  test('header, notice and clock', () => {
    assert({
      given: 'a live Round',
      should: 'show the title, the delay, the audience and a static clock',
      actual: [
        html.includes('<h1'),
        html.includes('Top of the ladder'),
        html.includes('03:48'),
        html.includes('142 watching'),
        html.includes('Delayed 30 s'),
        html.includes('Speech [3]'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the speaker large, the other debater inset', () => {
    assert({
      given: 'Aff speaking',
      should:
        'mark the Aff tile speaking and show Neg without a state, then the seats',
      actual: [
        html.includes('aria-label="@debater-a, speaking"'),
        html.includes('aria-label="@debater-b"'),
        html.includes('Copy link'),
        html.includes('S3 · now'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('offers no control that does nothing', () => {
    const chat = render(view('top-of-the-ladder', { pane: 'chat' }));
    assert({
      given: 'the live view',
      should: 'link Leave to the hub, with no inert action in any pane',
      actual: [
        html.includes('href="/watch"'),
        html.includes('?did='),
        chat.includes('?did='),
        html.includes('Report'),
        chat.includes('chat-draft'),
        html.includes('Follow both'),
      ],
      expected: [true, false, false, false, false, false],
    });
  });

  test('the live column pane comes from the URL', () => {
    const chat = render(view('top-of-the-ladder', { pane: 'chat' }));
    assert({
      given: 'the transcript by default, then the chat pane selected',
      should: 'show one pane at a time with its tab current',
      actual: [
        html.includes('Speech transcript'),
        html.includes('Chat messages'),
        /aria-current="page"[^>]*>Transcript/.test(html),
        html.includes('href="/watch/top-of-the-ladder?pane=chat"'),
        chat.includes('Speech transcript'),
        chat.includes('Chat messages'),
        /aria-current="page"[^>]*>Chat/.test(chat),
      ],
      expected: [true, false, true, true, false, true, true],
    });
  });
});

describe('Spectate: connection lost', () => {
  test('reconnecting', () => {
    const html = render({
      ...view('top-of-the-ladder'),
      connection: 'reconnecting',
    });
    assert({
      given: 'the audience connection dropped',
      should: 'say so, offer Try now and show an unknown clock',
      actual: [
        html.includes('Connection lost. Reconnecting.'),
        html.includes('>Try now<'),
        html.includes('--:--'),
        html.includes('03:48'),
      ],
      expected: [true, true, true, false],
    });
  });
});

describe('Spectate: ended', () => {
  test('ballots pending', () => {
    const html = render(view('evening-round'));
    const chat = render(view('evening-round', { pane: 'chat' }));
    assert({
      given: 'an ended Round waiting on ballots',
      should:
        'say so, link to the recording, show both debaters, close reactions and chat',
      actual: [
        html.includes('speaking"'),
        chat.includes('Reactions are closed.'),
        html.includes('This debate has ended.'),
        html.includes('href="/recordings/evening-round"'),
        html.includes('Open the recording'),
        html.includes('Chat closed'),
        html.includes('Final transcript'),
        html.includes('Ballots are being collected'),
        html.includes('03:48'),
      ],
      expected: [false, true, true, true, true, true, true, true, false],
    });
  });

  test('result published', () => {
    const html = render(view('semifinal-rehearsal'));
    assert({
      given: 'an ended Round with its result',
      should: 'announce the winner and link to the replay',
      actual: [
        html.includes('Neg wins, 2 to 1'),
        html.includes('Watch the replay'),
        html.includes('href="/recordings/semifinal-rehearsal"'),
      ],
      expected: [true, true, true],
    });
  });
});

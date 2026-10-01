import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/debate-source';
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
  const screen = openSpectate(id, watchViewer(true), query);
  if (screen.kind !== 'watch') throw new Error('not watchable');
  return screen.view;
};
const render = (v: SpectateView) => renderToString(h(Spectate, { view: v }));

describe('Spectate: live', () => {
  const html = render(view('top-of-the-ladder'));

  test('header, notice and clock', () => {
    assert({
      given: 'a live debate',
      should: 'show the title, the delay notice and a static clock',
      actual: [
        html.includes('<h1'),
        html.includes('Top of the ladder'),
        html.includes('about 30 seconds behind'),
        html.includes('03:48'),
        html.includes('142 watching'),
        html.includes('Delayed 30 s'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('actions are links or inert, never fake mutations', () => {
    assert({
      given: 'the live view',
      should:
        'link Leave to the hub and Report to its dialog; chat, reactions, follow are disabled',
      actual: [
        html.includes('href="/watch?report=debate"') ||
          html.includes('href="/watch/top-of-the-ladder?report=debate"'),
        html.includes('href="/watch"'),
        /<input id="chat-draft"[^>]*disabled=""/.test(html),
        (html.match(/disabled=""/g) ?? []).length >= 7,
        html.includes('role="dialog"'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('phone panes come from the URL', () => {
    const chat = render(
      view('top-of-the-ladder', { pane: 'chat', report: null }),
    );
    assert({
      given: 'the chat pane selected',
      should: 'hide the speeches pane on the phone and mark the tab current',
      actual: [
        chat.includes('max-compact:hidden'),
        /aria-current="page"[^>]*>Chat/.test(chat),
        html.includes('href="/watch/top-of-the-ladder?pane=about"'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('Spectate: report dialog', () => {
  test('open from the URL', () => {
    const html = render(
      view('top-of-the-ladder', {
        pane: 'speeches',
        report: { kind: 'debate' },
      }),
    );
    assert({
      given: 'a report open on the debate',
      should: 'show the dialog with reasons, a Cancel link and an inert Send',
      actual: [
        html.includes('role="dialog"'),
        html.includes('Report the debate'),
        html.includes('Cheating or outside help'),
        /href="\/watch\/top-of-the-ladder"[^>]*>Cancel/.test(html),
        /<button [^>]*disabled=""[^>]*>Send report/.test(html),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('a message report names its author', () => {
    const html = render(
      view('top-of-the-ladder', {
        pane: 'chat',
        report: { kind: 'message', id: 'c2' },
      }),
    );
    assert({
      given: 'a report open on a chat message',
      should: 'name the author and keep the pane on Cancel',
      actual: [
        html.includes('Report a message from @spectator-two'),
        html.includes('href="/watch/top-of-the-ladder?pane=chat"'),
      ],
      expected: [true, true],
    });
  });

  test('after a report was sent', () => {
    const html = render({ ...view('top-of-the-ladder'), reportSent: true });
    assert({
      given: 'a sent report',
      should: 'confirm it',
      actual: html.includes('Report sent. Moderators will review it.'),
      expected: true,
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
    assert({
      given: 'an ended debate waiting on ballots',
      should: 'explain, link to the recording, close reactions and chat',
      actual: [
        html.includes('This debate has ended.'),
        html.includes('href="/recordings/evening-round"'),
        html.includes('Open the recording'),
        html.includes('Reactions are closed.'),
        html.includes('Chat closed when the debate ended.'),
        html.includes('Final transcript'),
        html.includes('Ballots are being collected'),
        html.includes('03:48'),
      ],
      expected: [true, true, true, true, true, true, true, false],
    });
  });

  test('result published', () => {
    const html = render(view('semifinal-rehearsal'));
    assert({
      given: 'an ended debate with its result',
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

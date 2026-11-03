import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { DebateRoom } from './room';
import type { RoundSnapshot } from './round';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderToString(h(DebateRoom, { round: sampleRound(...args) }));

const renderRound = (round: RoundSnapshot) =>
  renderToString(h(DebateRoom, { round }));

const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;

const before = (html: string, first: string, second: string) =>
  html.indexOf(first) >= 0 && html.indexOf(first) < html.indexOf(second);

describe('DebateRoom', () => {
  test('the frame before any script runs', () => {
    const html = render('opponent-speaking', 'casual');
    assert({
      given: 'a casual round while the opponent speaks',
      should:
        'draw the round section, the clock, then Files, the document and a sidebar with three tabs',
      actual: [
        html.includes('aria-label="Round"'),
        html.includes('role="timer" aria-label="1AR 2:46"'),
        before(html, 'aria-label="Round"', 'aria-label="Your files"'),
        before(html, 'aria-label="Your files"', 'aria-label="Document"'),
        before(html, 'aria-label="Document"', 'aria-label="Round sidebar"'),
        count(html, /role="tab"/g),
        html.includes('role="separator"'),
      ],
      expected: [true, true, true, true, true, 3, false],
    });
  });

  test('the same help in every Round', () => {
    const tabs = (html: string) =>
      [...html.matchAll(/role="tab"[^>]*>([^<]+)/g)].map((m) => m[1]);
    const ranked = render('prep', 'ranked');
    assert({
      given: 'a ranked Round and a casual one',
      should:
        'offer both the same tabs and the AI panel, and mark only the rank',
      actual: [
        tabs(ranked),
        tabs(ranked).join() === tabs(render('prep', 'casual')).join(),
        ranked.includes('Ask Assistant'),
        ranked.includes('>Ranked<'),
      ],
      expected: [['Transcript', 'Channels', 'AI chat'], true, true, true],
    });
  });

  test('the round bar', () => {
    const html = render('opponent-speaking', 'casual');
    assert({
      given: 'a casual round with a human judge, recording',
      should:
        'show the kind, the live speech as the current step, the anonymous judge, Recording and Leave round',
      actual: [
        html.includes('Casual'),
        html.includes('aria-current="step"'),
        html.includes('>Judge present<'),
        html.includes('● Recording'),
        html.includes('Leave round'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('no Mute anywhere', () => {
    const html = render('own-speech', 'casual');
    assert({
      given: 'the debater’s own speech',
      should:
        'state microphone permission without claiming capture and offer no mute control',
      actual: [
        html.includes('Mic permitted'),
        html.includes('Mic live'),
        /\bMute\b/.test(html),
      ],
      expected: [true, false, false],
    });
  });

  test('no style attributes', () => {
    assert({
      given: 'the server-rendered room',
      should: 'carry no style attribute the nonce CSP would refuse',
      actual: /\sstyle="/.test(render('prep', 'casual')),
      expected: false,
    });
  });

  test('no layout controls', () => {
    const html = render('cross-ex', 'casual');
    assert({
      given: 'any phase',
      should: 'offer no layout menu and no video divider',
      actual: [html.includes('Layout:'), html.includes('Resize video')],
      expected: [false, false],
    });
  });

  test('the transcript slot', () => {
    const round = sampleRound('opponent-speaking', 'casual');
    const slot = renderToString(
      h(DebateRoom, { round, transcript: h('p', null, 'the line') }),
    );
    assert({
      given: 'a viewer with a transcript, then one without',
      should:
        'show it in the sidebar’s open panel, else say there is none and keep the panel',
      actual: [
        slot.includes('the line'),
        slot.includes('No transcript.'),
        renderRound(round).includes('No transcript.'),
      ],
      expected: [true, false, true],
    });
  });

  test('without script a phone keeps every panel readable', () => {
    const html = renderToString(
      h(DebateRoom, {
        round: sampleRound('opponent-speaking', 'casual'),
        transcript: h('p', null, 'the line'),
      }),
    );
    assert({
      given: 'the server’s markup, before any script runs',
      should:
        'stack the panels in one scroll, hide none for the phone and show the transcript',
      actual: [
        html.includes('room-stacked'),
        /id="round-sidebar"[^>]*max-compact:hidden/.test(html),
        /id="round-document"[^>]*max-compact:hidden/.test(html),
        html.includes('the line'),
      ],
      expected: [true, false, false, true],
    });
  });

  test('page notices stay inside the frame', () => {
    const html = renderToString(
      h(DebateRoom, {
        round: sampleRound('prep', 'casual'),
        notices: h('p', null, 'the notice'),
      }),
    );
    assert({
      given: 'a page-level notice',
      should: 'render it inside the viewport-height frame',
      actual: [
        html.indexOf('room-frame') >= 0,
        html.indexOf('room-frame') < html.indexOf('the notice'),
        html.indexOf('the notice') < html.indexOf('aria-label="Round"'),
      ],
      expected: [true, true, true],
    });
  });

  test('the judging window', () => {
    const html = render('judging', 'ranked');
    assert({
      given: 'a ranked round after the last speech, a human judge writing',
      should:
        'count down the judging window, list each ballot with its status, keep the judge anonymous and offer Report a problem',
      actual: [
        html.includes('role="timer" aria-label="Judging window 24:10"'),
        html.includes('aria-label="Ballots"'),
        html.includes('>Judge’s ballot<'),
        html.includes('>Writing · decides the rating<'),
        html.includes('>AI ballot<'),
        html.includes('>Ready · opens with the judge’s<'),
        html.includes('>Judge present<'),
        html.includes('>Report a problem<'),
        html.includes('>Tech issue<'),
        html.includes('>End speech<'),
        html.includes('Your prep'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
      ],
    });
  });

  test('no ballots outside judging', () => {
    assert({
      given: 'the opponent speaking',
      should: 'show no ballot section',
      actual: render('opponent-speaking', 'ranked').includes(
        'aria-label="Ballots"',
      ),
      expected: false,
    });
  });

  test('the AI judges', () => {
    const round = sampleRound('judging', 'casual');
    const html = renderRound({
      ...round,
      judge: 'ai',
      ballots: { judge: 'ai', ai: null },
    });
    assert({
      given: 'a casual round the AI judges, after the last speech',
      should: 'show the AI judge’s ballot alone, deciding the result',
      actual: [
        html.includes('>AI judge’s ballot<'),
        html.includes('>Writing · decides the result<'),
        html.includes('>AI ballot<'),
      ],
      expected: [true, true, false],
    });
  });

  test('the recording after the last speech', () => {
    const html = render('judging', 'casual');
    assert({
      given: 'the judging window of a recorded round',
      should: 'mark the recording stopped',
      actual: [html.includes('>Recording stopped<'), html.includes('● Rec')],
      expected: [true, false],
    });
  });

  test('44px targets and 12px sidebar text', () => {
    const html = render('judging', 'casual');
    assert({
      given: 'the sidebars',
      should:
        'size the file and new-document controls at the target and keep text at 12px or more',
      actual: [
        /aria-label="New document" class="[^"]*size-room-target/.test(html),
        /aria-label="Hide files"[^>]*class="[^"]*size-room-target/.test(html),
        html.includes('text-2xs'),
      ],
      expected: [true, true, false],
    });
  });
});

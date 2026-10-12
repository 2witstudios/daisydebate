import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { DebateRoom } from './room';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderToString(h(DebateRoom, { round: sampleRound(...args) }));

const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;

describe('DebateRoom', () => {
  test('the frame before any script runs', () => {
    const html = render('opponent-speaking', 'practice');
    assert({
      given: 'a practice round while the opponent speaks',
      should:
        'draw the round bar, one drawer with four tabs, the debaters, the centred clock, one video divider and the document',
      actual: [
        html.includes('aria-label="Hide drawer" aria-expanded="true"'),
        html.includes('aria-label="Round drawer"'),
        count(html, /role="tab"/g),
        html.includes('aria-label="Debaters"'),
        html.includes('role="timer" aria-label="1AR 2:46"'),
        count(html, /role="separator"/g),
        html.includes('aria-label="Document"'),
      ],
      expected: [true, true, 4, true, true, 1, true],
    });
  });

  test('the round bar', () => {
    const html = render('opponent-speaking', 'practice');
    assert({
      given: 'a practice round with a human judge, recording',
      should:
        'show the kind, the live speech as the current step, the anonymous judge, Rec and Leave',
      actual: [
        html.includes('>Practice<'),
        html.includes('aria-current="step"'),
        html.includes('>Judge present<'),
        html.includes('● Rec'),
        html.includes('aria-label="Leave room"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('no Mute anywhere', () => {
    const html = render('own-speech', 'practice');
    assert({
      given: 'the debater’s own speech',
      should: 'say the mic is live and offer no mute control',
      actual: [html.includes('Mic live'), /\bMute\b/.test(html)],
      expected: [true, false],
    });
  });

  test('no style attributes', () => {
    assert({
      given: 'the server-rendered room',
      should: 'carry no style attribute the nonce CSP would refuse',
      actual: /\sstyle="/.test(render('prep', 'practice')),
      expected: false,
    });
  });

  test('a ranked round', () => {
    const html = render('prep', 'ranked');
    assert({
      given: 'a ranked round',
      should: 'show the Ranked badge and offer Files, Chat and Room only',
      actual: [
        html.includes('>Ranked<'),
        count(html, /role="tab"/g),
        />AI</.test(html),
      ],
      expected: [true, 3, false],
    });
  });

  test('own speech', () => {
    assert({
      given: 'the debater’s own speech',
      should: 'offer the two-press end of speech',
      actual: render('own-speech', 'practice').includes('End speech'),
      expected: true,
    });
  });

  test('the layout menu', () => {
    assert({
      given: 'Auto layout during cross-examination',
      should: 'name the preset Auto chose on the menu button',
      actual: render('cross-ex', 'practice').includes(
        'aria-label="Layout: Auto, Stage"',
      ),
      expected: true,
    });
  });
});

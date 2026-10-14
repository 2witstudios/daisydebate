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
      should:
        'show the Ranked badge, offer Files, Chat and Room only, and list no club folder',
      actual: [
        html.includes('>Ranked<'),
        count(html, /role="tab"/g),
        />AI</.test(html),
        html.includes('Riverside Debate'),
        render('prep', 'practice').includes('Riverside Debate'),
      ],
      expected: [true, 3, false, false, true],
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

  test('the speaker layout', () => {
    const html = render('opponent-speaking', 'practice');
    assert({
      given: 'Auto while the opponent speaks',
      should:
        'name Speaker on the menu, put the speaker in the large tile and list what comes next',
      actual: [
        html.includes('aria-label="Layout: Auto, Speaker"'),
        html.includes('aria-label="Maya Okafor, speaking"'),
        html.includes('aria-label="Sam Reyes, you"'),
        />Next</.test(html),
        />NR · You · 5:00</.test(html),
        />Then</.test(html),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('cross-examination', () => {
    const html = render('cross-ex', 'practice');
    assert({
      given: 'cross-examination',
      should: 'show the asker and the answerer as equal tiles',
      actual: [
        html.includes('aria-label="Sam Reyes, you, asking"'),
        html.includes('aria-label="Maya Okafor, answering"'),
      ],
      expected: [true, true],
    });
  });

  test('prep and judging', () => {
    assert({
      given: 'prep, then judging',
      should: 'make the video small, then hold a conversation',
      actual: [
        render('prep', 'practice').includes('aria-label="Layout: Auto, Focus"'),
        render('judging', 'practice').includes(
          'aria-label="Layout: Auto, Conversation"',
        ),
      ],
      expected: [true, true],
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
    const round = sampleRound('judging', 'practice');
    const html = renderRound({
      ...round,
      judge: 'ai',
      ballots: { judge: 'ai', ai: null },
    });
    assert({
      given: 'a practice round the AI judges, after the last speech',
      should: 'show the AI judge’s ballot alone, deciding the result',
      actual: [
        html.includes('>AI judge’s ballot<'),
        html.includes('>Writing · decides the result<'),
        html.includes('>AI ballot<'),
      ],
      expected: [true, true, false],
    });
  });

  test('the transcript after the last speech', () => {
    const html = render('judging', 'practice');
    assert({
      given: 'the judging window of a transcribed, recorded round',
      should: 'mark the transcript complete and the recording stopped',
      actual: [
        html.includes('● Live'),
        html.includes('>Complete<'),
        html.includes('>Rec stopped<'),
        html.includes('● Rec'),
      ],
      expected: [false, true, true, false],
    });
  });

  test('44px targets and 12px drawer text', () => {
    const html = render('judging', 'practice');
    const drawer = html.slice(
      html.indexOf('aria-label="Round drawer"'),
      html.indexOf('id="round-column"'),
    );
    assert({
      given: 'the judging window with its transcript open',
      should:
        'size the filter chips, Add to Flow and the video divider at the target, ring the divider on focus, and keep drawer text at 12px or more',
      actual: [
        count(html, /aria-pressed="(?:true|false)" class="h-room-target /g) > 1,
        count(html, /aria-label="Add to Flow" class="flex size-room-target /g) >
          0,
        /role="separator"[^>]*class="[^"]*h-room-target[^"]*focus-visible:ring-2/.test(
          html,
        ),
        drawer.length > 0 && !drawer.includes('text-2xs'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a bot opponent', () => {
    const round = sampleRound('opponent-speaking', 'practice');
    const html = renderRound({
      ...round,
      opponent: {
        ...round.opponent,
        name: 'Wren',
        bot: { level: 'Intermediate' },
      },
      voiceLevel: 0.5,
    });
    assert({
      given: 'a bot opponent speaking',
      should:
        'show its persona card with a voice meter and live captions instead of a video tile',
      actual: [
        html.includes('aria-label="Wren, speaking"'),
        html.includes('>Bot · Intermediate · Aff<'),
        html.includes('role="meter" aria-label="Voice level"'),
        html.includes('aria-valuenow="50"'),
        html.includes(
          'role="log" aria-live="polite" aria-label="Live captions"',
        ),
        html.includes('Fibers degrade within months.'),
        html.includes('aria-label="Debaters"'),
      ],
      expected: [true, true, true, true, true, true, false],
    });
  });
});

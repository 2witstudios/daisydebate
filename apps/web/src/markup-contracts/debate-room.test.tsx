import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { sampleRound } from '../ui/mock/debate-room.test-support';
import { DebateRoom } from '../ui/debate-room/room';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderMarkup(h(DebateRoom, { round: sampleRound(...args) }));

/**
 * The room's markup itself is the subject here: a nonce CSP refuses inline
 * style attributes, and the frame, the phone's stacked layout, touch target
 * sizes and the smallest text size are design-system classes with no
 * accessible equivalent.
 */
describe('DebateRoom markup', () => {
  test('no style attributes', () => {
    assert({
      given: 'the server-rendered room',
      should: 'carry no style attribute the nonce CSP would refuse',
      actual: /\sstyle="/.test(render('prep', 'casual')),
      expected: false,
    });
  });

  test('before hydration a phone keeps every panel readable', () => {
    const html = renderMarkup(
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
        /id="open-document"[^>]*max-compact:hidden/.test(html),
        html.includes('the line'),
      ],
      expected: [true, false, false, true],
    });
  });

  test('page notices stay inside the frame', () => {
    const html = renderMarkup(
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
      ],
      expected: [true, true],
    });
  });

  test('input-aware targets and 12px sidebar text', () => {
    const html = render('judging', 'casual');
    assert({
      given: 'the sidebars',
      should: 'size Files controls for the input and keep text at 12px or more',
      actual: [
        /<button(?=[^>]*aria-label="New")[^>]*class="[^"]*size-dense-target/.test(
          html,
        ),
        /<button(?=[^>]*aria-label="Hide files")[^>]*class="[^"]*size-dense-target/.test(
          html,
        ),
        html.includes('text-2xs'),
      ],
      expected: [true, true, false],
    });
  });
});

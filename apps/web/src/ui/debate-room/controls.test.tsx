import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { DebateRoom } from './room';
import { Composer } from './threads';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderToString(h(DebateRoom, { round: sampleRound(...args) }));

describe('DebateRoom controls', () => {
  test('controls with no server command (DEC-178)', () => {
    const disabled = (html: string, label: string) =>
      new RegExp(`<button[^>]*disabled=""[^>]*>${label}<`).test(html);
    const prep = render('prep', 'practice');
    const speech = render('own-speech', 'practice');
    const cx = render('cross-ex', 'practice');
    const chat = renderToString(
      h(Composer, { label: 'Message # round', tone: 'chat' }),
    );
    assert({
      given: 'prep, the debater’s own speech and cross-examination',
      should:
        'show Save the rest, Start, End speech and Interrupt, each disabled, and a disabled chat box',
      actual: [
        disabled(prep, 'Save the rest'),
        disabled(prep, 'Start (<!-- -->)?NR'),
        disabled(speech, 'End speech'),
        disabled(cx, 'Interrupt'),
        /<input[^>]*aria-label="Message # round"[^>]*disabled=""/.test(chat),
        /aria-label="Send"[^>]*disabled=""/.test(chat),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});

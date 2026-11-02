import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { LocalPublication } from '../../features/round-media/model/media-publication';
import { sampleRound } from '../mock/debate-room';
import { DebateRoom } from './room';
import { liveRoundOf } from './live-round';
import {
  aff,
  origin,
  rules,
  startOf,
  unjudgedClosed,
} from './live-round.test-support';
import { Composer } from './threads';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderToString(h(DebateRoom, { round: sampleRound(...args) }));

describe('DebateRoom controls', () => {
  test('controls with no server command (DEC-178)', () => {
    const disabled = (html: string, label: string) =>
      new RegExp(`<button[^>]*disabled=""[^>]*>${label}<`).test(html);
    const prep = render('prep', 'casual');
    const speech = render('own-speech', 'casual');
    const cx = render('cross-ex', 'casual');
    const chat = renderToString(
      h(Composer, { label: 'Message # round', tone: 'chat' }),
    );
    assert({
      given: 'prep, the debater’s own speech and cross-examination',
      should:
        'show disabled Start and End speech, no Interrupt, and a disabled chat box',
      actual: [
        !prep.includes('Save the rest'),
        disabled(prep, 'Start (<!-- -->)?negative rebuttal'),
        disabled(speech, 'End speech'),
        !cx.includes('Interrupt'),
        /<input[^>]*aria-label="Message # round"[^>]*disabled=""/.test(chat),
        /aria-label="Send"[^>]*disabled=""/.test(chat),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a zero-judge Round after its last speech', () => {
    const round = liveRoundOf(
      unjudgedClosed(),
      aff.actorId,
      origin + startOf(rules.length) + 60_000,
    );
    const html = round ? renderToString(h(DebateRoom, { round })) : '';
    assert({
      given: 'a Round with no judge seat whose speeches have closed',
      should: 'read Finished with no judging clock, label or ballot',
      actual: [
        html.includes('>Finished<'),
        html.includes('Judging'),
        html.includes('ballot'),
      ],
      expected: [true, false, false],
    });
  });
});

test('floor permission before media evidence never claims actual microphone publication', () => {
  const html = render('own-speech', 'casual');
  assert({
    given: 'a permitted speaker before a client media session has reported',
    should: 'describe permission without claiming a live microphone',
    actual: [html.includes('Mic live'), html.includes('Mic permitted')],
    expected: [false, true],
  });
});

test('a released connection speaks only to the seat with the floor', () => {
  const label = (publication: LocalPublication, micLive: boolean) => {
    const html = renderToString(
      h(DebateRoom, {
        round: { ...sampleRound('own-speech', 'casual'), micLive },
        publication,
      }),
    );
    return ['Mic reconnecting', 'Mic not connected', 'Mic closed'].find(
      (text) => html.includes(text),
    );
  };
  assert({
    given: 'recovery running or stopped, with and without the floor',
    should: 'say which on the floor, and just closed off it',
    actual: [
      label('ill', true),
      label('disconnected', true),
      label('ill', false),
      label('disconnected', false),
    ],
    expected: [
      'Mic reconnecting',
      'Mic not connected',
      'Mic closed',
      'Mic closed',
    ],
  });
});

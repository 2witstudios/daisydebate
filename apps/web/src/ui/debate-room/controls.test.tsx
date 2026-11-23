import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { LocalPublication } from '../../features/round-media/model/media-publication';
import { sampleRound } from '../mock/debate-room.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
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
  renderAccessible(h(DebateRoom, { round: sampleRound(...args) }));

describe('DebateRoom controls', () => {
  test('controls with no server command', () => {
    // The phone's action row repeats the controls; the Round section's are read.
    const disabled = (view: AccessibleView, label: string) =>
      view
        .within('region', 'Round')
        .get('button', label)
        .hasAttribute('disabled');
    const prep = render('prep', 'casual');
    const prepFacts = [
      !prep.textContent().includes('Save the rest'),
      disabled(prep, 'Start negative rebuttal'),
    ];
    const speech = disabled(render('own-speech', 'casual'), 'End speech');
    const cx = render('cross-ex', 'casual').textContent();
    const chat = renderAccessible(
      h(Composer, { label: 'Message # round', tone: 'chat' }),
    );
    assert({
      given: 'prep, the debater’s own speech and cross-examination',
      should:
        'show disabled Start and End speech, no Interrupt, and a disabled chat box',
      actual: [
        ...prepFacts,
        speech,
        !cx.includes('Interrupt'),
        chat.get('textbox', 'Message # round').hasAttribute('disabled'),
        chat.get('button', 'Send').hasAttribute('disabled'),
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
    const view = round ? renderAccessible(h(DebateRoom, { round })) : null;
    const text = view?.textContent() ?? '';
    assert({
      given: 'a Round with no judge seat whose speeches have closed',
      should: 'read Finished with no judging clock, label or ballot',
      actual: [
        view?.within('region', 'Round').textContent().includes('Finished'),
        text.includes('Judging'),
        view?.count('timer'),
        text.includes('ballot'),
        view?.has('region', 'Ballots'),
      ],
      expected: [true, false, 0, false, false],
    });
  });
});

test('floor permission before media evidence never claims actual microphone publication', () => {
  const text = render('own-speech', 'casual').textContent();
  assert({
    given: 'a permitted speaker before a client media session has reported',
    should: 'describe permission without claiming a live microphone',
    actual: [text.includes('Mic live'), text.includes('Mic permitted')],
    expected: [false, true],
  });
});

test('a released connection speaks only to the seat with the floor', () => {
  const label = (publication: LocalPublication, micLive: boolean) => {
    const text = renderAccessible(
      h(DebateRoom, {
        round: { ...sampleRound('own-speech', 'casual'), micLive },
        publication,
      }),
    )
      .within('region', 'Round')
      .textContent();
    return ['Mic reconnecting', 'Mic not connected', 'Mic closed'].find(
      (label) => text.includes(label),
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

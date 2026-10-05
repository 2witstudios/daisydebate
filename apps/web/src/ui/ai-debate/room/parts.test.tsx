import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Controls, Transcript, type ControlActions } from './parts';
import type { RoomView } from './store';

setupRitewayBun();

const noop = () => undefined;
const actions = new Proxy({}, { get: () => noop }) as ControlActions;

describe('Controls', () => {
  test('before the debate begins', () => {
    const html = renderToString(
      h(Controls, {
        state: { phase: 'waiting' },
        personSide: 'affirmative',
        joined: false,
        busy: false,
        actions,
      }),
    );
    assert({
      given: 'a debate that has not begun',
      should: 'offer Begin debate with no explanation around it',
      actual: [html.includes('>Begin debate<'), html.includes('<p')],
      expected: [true, false],
    });
  });
});

describe('Transcript', () => {
  test('nothing said yet', () => {
    const html = renderToString(
      h(Transcript, {
        view: { utterances: [] } as unknown as RoomView,
        opponent: 'Wren',
      }),
    );
    assert({
      given: 'a debate with no speech yet',
      should: 'say nothing has been said',
      actual: html.includes('Nothing said yet'),
      expected: true,
    });
  });
});

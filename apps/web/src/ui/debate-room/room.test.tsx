import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { DebateRoom } from './room';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderToString(h(DebateRoom, { round: sampleRound(...args) }));

describe('DebateRoom', () => {
  test('the room before any script runs', () => {
    const html = render('opponent-speaking', 'unrated');
    assert({
      given: 'the sample round while the opponent speaks',
      should:
        'draw the debaters, the centred clock, the three dividers, the files and the sidebar',
      actual: [
        html.includes('aria-label="Debaters"'),
        html.includes('role="timer" aria-label="1AR 2:46"'),
        (html.match(/role="separator"/g) ?? []).length,
        html.includes('aria-label="Files"'),
        html.includes('aria-label="Sidebar"'),
      ],
      expected: [true, true, 3, true, true],
    });
  });

  test('no style attributes', () => {
    assert({
      given: 'the server-rendered room',
      should: 'carry no style attribute the nonce CSP would refuse',
      actual: /\sstyle="/.test(render('prep', 'unrated')),
      expected: false,
    });
  });

  test('a rated round', () => {
    const html = render('prep', 'rated');
    assert({
      given: 'a rated round',
      should: 'offer the Chat tab and no AI tab',
      actual: [html.includes('>Chat<'), html.includes('>AI<')],
      expected: [true, false],
    });
  });

  test('own speech', () => {
    assert({
      given: 'the debater’s own speech',
      should: 'offer the two-press end of speech',
      actual: render('own-speech', 'unrated').includes('End speech'),
      expected: true,
    });
  });
});

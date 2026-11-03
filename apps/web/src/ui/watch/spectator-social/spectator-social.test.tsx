import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  spectatorSocial,
  findRound,
} from '../../../features/watch/sample-source.test-support';
import { ChatMessages, Reactions } from './spectator-social';

setupRitewayBun();

const round = findRound('top-of-the-ladder');
if (!round) throw new Error('sample missing');
const social = spectatorSocial(round);

describe('Reactions', () => {
  test('open: read-only totals', () => {
    const html = renderToString(
      h(Reactions, { reactions: social.reactions, open: true }),
    );
    assert({
      given: 'an open audience',
      should: 'show every total, with no inert control',
      actual: [html.includes('Sharp point 38'), html.includes('?did=')],
      expected: [true, false],
    });
  });

  test('closed', () => {
    const html = renderToString(
      h(Reactions, { reactions: social.reactions, open: false }),
    );
    assert({
      given: 'an ended Round',
      should: 'say reactions are closed',
      actual: html.includes('Reactions are closed.'),
      expected: true,
    });
  });
});

describe('ChatMessages', () => {
  test('messages, read-only', () => {
    const html = renderToString(h(ChatMessages, { messages: social.messages }));
    assert({
      given: 'spectator chat',
      should: 'list messages and a removed one, and offer no inert report link',
      actual: [
        html.includes('The criterion fight is the whole round.'),
        html.includes('A message was removed by a moderator.'),
        html.includes('Report'),
      ],
      expected: [true, true, false],
    });
  });
});

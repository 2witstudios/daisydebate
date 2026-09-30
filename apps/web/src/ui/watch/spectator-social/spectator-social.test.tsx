import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertReason } from '../../../features/watch/actions';
import {
  spectatorSocial,
  findDebate,
} from '../../../features/watch/debate-source';
import { defaultSpectateQuery } from '../../../features/watch/spectate-query';
import { Chat, Reactions } from './spectator-social';

setupRitewayBun();

const debate = findDebate('top-of-the-ladder');
if (!debate) throw new Error('sample missing');
const social = spectatorSocial(debate);

describe('Reactions', () => {
  test('open: inert buttons with totals', () => {
    const html = renderToString(
      h(Reactions, { reactions: social.reactions, open: true }),
    );
    assert({
      given: 'an open audience',
      should: 'show every total on a disabled button with its reason',
      actual: [
        html.includes('Sharp point 38'),
        (html.match(/disabled=""/g) ?? []).length,
        html.includes(inertReason('react')),
        html.includes('Anonymous totals.'),
      ],
      expected: [true, 4, true, true],
    });
  });

  test('closed', () => {
    const html = renderToString(
      h(Reactions, { reactions: social.reactions, open: false }),
    );
    assert({
      given: 'an ended debate',
      should: 'say reactions are closed',
      actual: html.includes('Reactions are closed.'),
      expected: true,
    });
  });
});

describe('Chat', () => {
  test('open: messages, report links and an inert composer', () => {
    const html = renderToString(
      h(Chat, {
        id: 'top-of-the-ladder',
        query: defaultSpectateQuery,
        social,
        open: true,
      }),
    );
    assert({
      given: 'open chat',
      should:
        'list messages, a removed one, report links and a disabled composer',
      actual: [
        html.includes('The criterion fight is the whole round.'),
        html.includes('A message was removed by a moderator.'),
        html.includes('href="/watch/top-of-the-ladder?report=message%3Ac1"'),
        /<input id="chat-draft"[^>]*disabled=""/.test(html),
        html.includes('Slow mode'),
        html.includes(social.chatRules),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('closed', () => {
    const html = renderToString(
      h(Chat, { id: 'x', query: defaultSpectateQuery, social, open: false }),
    );
    assert({
      given: 'chat after the debate ends',
      should: 'say it closed and offer no composer or report links',
      actual: [
        html.includes('Chat closed when the debate ended.'),
        html.includes('chat-draft'),
        html.includes('Report this message'),
      ],
      expected: [true, false, false],
    });
  });
});

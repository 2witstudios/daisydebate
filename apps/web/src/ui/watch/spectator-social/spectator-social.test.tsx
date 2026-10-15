import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  spectatorSocial,
  findDebate,
} from '../../../features/watch/debate-source';
import { defaultSpectateQuery } from '../../../features/watch/spectate-query';
import { ChatComposer, ChatMessages, Reactions } from './spectator-social';

setupRitewayBun();

const debate = findDebate('top-of-the-ladder');
if (!debate) throw new Error('sample missing');
const social = spectatorSocial(debate);

describe('Reactions', () => {
  test('open: sample buttons with totals', () => {
    const html = renderToString(
      h(Reactions, { reactions: social.reactions, open: true }),
    );
    assert({
      given: 'an open audience',
      should: 'show every total on a working sample button, none disabled',
      actual: [
        html.includes('Sharp point 38'),
        (html.match(/href="\?did=React"/g) ?? []).length,
        html.includes('disabled=""'),
      ],
      expected: [true, 4, false],
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

describe('ChatMessages', () => {
  test('open: messages and report links', () => {
    const html = renderToString(
      h(ChatMessages, {
        id: 'top-of-the-ladder',
        query: defaultSpectateQuery,
        messages: social.messages,
        open: true,
      }),
    );
    assert({
      given: 'open chat',
      should: 'list messages, a removed one and report links',
      actual: [
        html.includes('The criterion fight is the whole round.'),
        html.includes('A message was removed by a moderator.'),
        html.includes('href="/watch/top-of-the-ladder?report=message%3Ac1"'),
      ],
      expected: [true, true, true],
    });
  });

  test('closed', () => {
    const html = renderToString(
      h(ChatMessages, {
        id: 'x',
        query: defaultSpectateQuery,
        messages: social.messages,
        open: false,
      }),
    );
    assert({
      given: 'chat after the debate ends',
      should: 'keep the messages and offer no report links',
      actual: [
        html.includes('The criterion fight is the whole round.'),
        html.includes('Report this message'),
      ],
      expected: [true, false],
    });
  });
});

describe('ChatComposer', () => {
  test('open: a labelled composer under slow mode', () => {
    const html = renderToString(
      h(ChatComposer, { chatRules: social.chatRules, open: true }),
    );
    assert({
      given: 'open chat',
      should:
        'offer an enabled, labelled composer with no placeholder, slow mode and the rules',
      actual: [
        /<input id="chat-draft"/.test(html) &&
          !/<input id="chat-draft"[^>]*disabled/.test(html),
        html.includes('Message spectators'),
        html.includes('placeholder'),
        html.includes('Slow mode'),
        html.includes(social.chatRules),
      ],
      expected: [true, true, false, true, true],
    });
  });

  test('closed', () => {
    const html = renderToString(
      h(ChatComposer, { chatRules: social.chatRules, open: false }),
    );
    assert({
      given: 'chat after the debate ends',
      should: 'say it closed and offer no composer',
      actual: [html.includes('Chat closed'), html.includes('chat-draft')],
      expected: [true, false],
    });
  });
});

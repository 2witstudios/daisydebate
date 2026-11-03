import { createId } from '@paralleldrive/cuid2';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AudiencePanel, type AudiencePanelProps } from './audience-panel';

setupRitewayBun();

const snapshot = {
  version: 1 as const,
  roundId: createId(),
  interaction: 'open' as const,
  messages: [
    {
      id: createId(),
      sequence: 1,
      at: '2026-11-02T12:00:00.000Z',
      author: 'someone',
      text: 'A released line',
    },
    {
      id: createId(),
      sequence: 2,
      at: '2026-11-02T12:00:01.000Z',
      author: null,
      text: null,
    },
  ],
  reactions: [
    { kind: 'sharp_point' as const, count: 3 },
    { kind: 'good_rebuttal' as const, count: 0 },
    { kind: 'needs_evidence' as const, count: 0 },
    { kind: 'clear_structure' as const, count: 0 },
  ],
  viewers: 12,
};
const everything = { chat: true, reactions: true, viewers: true };
const action = async () => ({ values: {} });
const account = {
  kind: 'account' as const,
  requestId: createId(),
  postChat: action,
  react: action,
  reportMessage: () => undefined,
};
const visitor = { kind: 'visitor' as const, signInHref: '/sign-in' };
const render = (props: Partial<AudiencePanelProps>) =>
  renderToString(
    h(
      AppRouterContext,
      { value: {} as never },
      h(AudiencePanel, {
        initial: snapshot,
        viewer: visitor,
        shown: everything,
        ...props,
      }),
    ),
  );

describe('AudiencePanel', () => {
  test('a visitor reads everything and takes part in nothing', () => {
    const html = render({ viewer: visitor });
    assert({
      given: 'no account',
      should:
        'show the line, count and totals, tell them to sign in, and offer no form',
      actual: {
        line: html.includes('A released line'),
        removed: html.includes('This message was removed.'),
        count: html.includes('12 people watching'),
        total: html.includes('Sharp point 3'),
        signIn: html.includes('to chat and react'),
        forms: html.includes('<form'),
      },
      expected: {
        line: true,
        removed: true,
        count: true,
        total: true,
        signIn: true,
        forms: false,
      },
    });
  });

  test('an account posts, reacts and reports with native forms', () => {
    const html = render({ viewer: account });
    assert({
      given: 'a signed-in account on an open Round',
      should:
        'offer the composer, the reaction buttons and a report for the line',
      actual: {
        composer: html.includes('name="text"'),
        request: html.includes(account.requestId),
        react: html.includes('name="kind"'),
        report: html.includes('value="chat_message"'),
      },
      expected: { composer: true, request: true, react: true, report: true },
    });
  });

  test('a closed Round keeps its history and takes no more', () => {
    const html = render({
      viewer: account,
      initial: { ...snapshot, interaction: 'closed' },
    });
    assert({
      given: 'a completed or stopped Broadcast',
      should: 'keep the line and say chat is closed, with no composer',
      actual: [
        html.includes('A released line'),
        html.includes('Chat is closed.'),
        html.includes('name="text"'),
      ],
      expected: [true, true, false],
    });
  });

  test('a seat shown nothing sees no chat, total or count', () => {
    const html = render({
      viewer: account,
      initial: { ...snapshot, messages: [], reactions: [], viewers: null },
      shown: { chat: false, reactions: false, viewers: false },
    });
    assert({
      given: 'a ranked debater during the Round',
      should: 'say chat is hidden, with nothing of it or the count',
      actual: [
        html.includes('hidden from you during this Round'),
        html.includes('watching'),
        html.includes('Sharp point'),
        html.includes('name="text"'),
      ],
      expected: [true, false, false, false],
    });
  });
});

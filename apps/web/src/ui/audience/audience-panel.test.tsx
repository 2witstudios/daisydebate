import { idle } from '../../features/forms/form-state';
import { createId } from '@paralleldrive/cuid2';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
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
      text: 'A line',
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
const action = async () => idle();
const account = {
  kind: 'account' as const,
  requestId: createId(),
  postChat: action,
  react: action,
  reportMessage: () => undefined,
};
const visitor = { kind: 'visitor' as const, signInHref: '/sign-in' };
const render = (props: Partial<AudiencePanelProps>) =>
  renderAccessible(
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
/**
 * Every way to take part: named forms, and the buttons and fields any form
 * (an unnamed one has no role) would hold, closed report forms included.
 */
const forms = (view: AccessibleView) =>
  (['form', 'button', 'textbox', 'combobox'] as const)
    .map((role) => view.count(role, undefined, { hidden: true }))
    .reduce((sum, count) => sum + count, 0);
/** The value a form posts under a field name, hidden inputs included. */
const posted = (control: Element, field: string) => {
  const form = control.closest('form') as HTMLFormElement | null;
  const input = form?.elements.namedItem(field) as HTMLInputElement | null;
  return input?.value ?? null;
};
/** The report form under the chat line, closed until its details open. */
const reportButton = (view: AccessibleView) =>
  view
    .within('log', 'Chat messages')
    .all('button', 'Send report', { hidden: true });

describe('AudiencePanel', () => {
  test('a visitor reads everything and takes part in nothing', () => {
    const view = render({ viewer: visitor });
    const text = view.textContent();
    assert({
      given: 'no account',
      should:
        'show the line, count and totals, tell them to sign in, and offer no form',
      actual: {
        line: view
          .within('log', 'Chat messages')
          .textContent()
          .includes('A line'),
        removed: view
          .within('log', 'Chat messages')
          .textContent()
          .includes('This message was removed.'),
        count: text.includes('12 people watching'),
        total: view
          .all('listitem')
          .some((item) => item.textContent === 'Sharp point 3'),
        signIn: text.includes('Sign in to chat and react'),
        signInHref: view.attribute('link', 'Sign in', 'href'),
        forms: forms(view),
      },
      expected: {
        line: true,
        removed: true,
        count: true,
        total: true,
        signIn: true,
        signInHref: '/sign-in',
        forms: 0,
      },
    });
  });

  test('an account posts, reacts and reports with native forms', () => {
    const view = render({ viewer: account });
    const message = view
      .within('form', 'Post to spectator chat')
      .get('textbox', 'Your message');
    const [report] = reportButton(view);
    assert({
      given: 'a signed-in account on an open Round',
      should:
        'offer the composer, the reaction buttons and a report for the line',
      actual: {
        composer: message.getAttribute('name'),
        request: posted(message, 'requestId'),
        react: view
          .within('form', 'React to this Round')
          .all('button')
          .map((button) => [
            button.textContent,
            button.getAttribute('name'),
            button.getAttribute('value'),
          ]),
        report: report ? posted(report, 'targetKind') : null,
      },
      expected: {
        composer: 'text',
        request: account.requestId,
        react: [
          ['Sharp point 3', 'kind', 'sharp_point'],
          ['Good rebuttal 0', 'kind', 'good_rebuttal'],
          ['Needs evidence 0', 'kind', 'needs_evidence'],
          ['Clear structure 0', 'kind', 'clear_structure'],
        ],
        report: 'chat_message',
      },
    });
  });

  test('new messages reach a screen reader politely', () => {
    const view = render({ viewer: account });
    assert({
      given: 'the polled chat list',
      should: 'sit in a polite log region',
      actual: [
        view.has('log', 'Chat messages'),
        view.attribute('log', 'Chat messages', 'aria-live'),
      ],
      expected: [true, 'polite'],
    });
  });

  test('someone in the live room is told why they cannot post', () => {
    const view = render({
      viewer: {
        kind: 'live-room',
        reportMessage: account.reportMessage,
      },
    });
    const [report] = reportButton(view);
    assert({
      given: 'a debater, judge or seatless host on an open Round',
      should:
        'offer no composer and no reaction, say why plainly, and keep reporting',
      actual: {
        composer: view.has('textbox', 'Your message'),
        why: view.textContent().includes('you cannot post in its chat'),
        react: view.all('button', /^Sharp point/, { hidden: true }).length,
        report: report ? posted(report, 'targetKind') : null,
      },
      expected: {
        composer: false,
        why: true,
        react: 0,
        report: 'chat_message',
      },
    });
  });

  test('the composer promises no wait', () => {
    const view = render({ viewer: account });
    assert({
      given: 'an account about to post',
      should: 'not say a message waits for the broadcast',
      actual: view.textContent().includes('when the broadcast reaches'),
      expected: false,
    });
  });

  test('a closed Round keeps its history and takes no more', () => {
    const view = render({
      viewer: account,
      initial: { ...snapshot, interaction: 'closed' },
    });
    assert({
      given: 'a completed or stopped Broadcast',
      should: 'keep the line and say chat is closed, with no composer',
      actual: [
        view.within('log', 'Chat messages').textContent().includes('A line'),
        view.textContent().includes('Chat is closed.'),
        view.has('textbox', 'Your message', { hidden: true }),
      ],
      expected: [true, true, false],
    });
  });

  test('a seat shown nothing sees no chat, total or count', () => {
    const view = render({
      viewer: account,
      initial: { ...snapshot, messages: [], reactions: [], viewers: null },
      shown: { chat: false, reactions: false, viewers: false },
    });
    assert({
      given: 'a ranked debater during the Round',
      should: 'say chat is hidden, with nothing of it or the count',
      actual: [
        view.textContent().includes('hidden from you during this Round'),
        view.textContent().includes('watching'),
        view.textContent().includes('Sharp point'),
        view.has('textbox', 'Your message', { hidden: true }),
      ],
      expected: [true, false, false, false],
    });
  });

  test('a restricted account reads and joins nothing', () => {
    const view = render({ viewer: { kind: 'restricted' } });
    assert({
      given: 'an account under a suspension or ban',
      should:
        'show the chat and its reason, with no composer, reaction or report',
      actual: {
        reason: view.textContent().includes('Your account is restricted'),
        forms: forms(view),
      },
      expected: { reason: true, forms: 0 },
    });
  });
});

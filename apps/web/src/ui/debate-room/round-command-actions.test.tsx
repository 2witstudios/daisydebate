import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
setupRitewayBun();
mockNextRouter();
const { answerFocusTarget, CommandForm, shownError } =
  await import('./round-command-actions');
const { roundCommandUnavailable, submitRoundForm } =
  await import('../../features/round-runtime/command-form');

const intent = {
  type: 'yield' as const,
  label: 'End speech',
  participantId: 'p'.repeat(24),
  enabled: true,
  confirm: true,
};
const expectedVersion = (answer: Parameters<typeof CommandForm>[0]['answer']) =>
  /name="expectedVersion" value="(\d+)"/.exec(
    renderToStaticMarkup(
      <CommandForm
        intent={intent}
        commandId={'c'.repeat(24)}
        version={3}
        segment="1"
        post={() => undefined}
        answer={answer}
        pending={false}
        control="control"
      />,
    ),
  )?.[1];

test('a confirmation confirms the round the debater sees now (ISSUE-838)', () => {
  assert({
    given:
      'a first End speech press stamped at version 2, answered with a confirmation, while the view has reached version 3; and an unacknowledged attempt at version 2',
    should:
      'confirm against version 3, and replay the unacknowledged attempt with its original version 2',
    actual: [
      expectedVersion({
        kind: 'confirming',
        values: {
          type: 'yield',
          expectedVersion: '2',
          commandId: 'c'.repeat(24),
        },
      }),
      expectedVersion({
        kind: 'unacknowledged',
        values: {
          type: 'yield',
          expectedVersion: '2',
          commandId: 'c'.repeat(24),
        },
      }),
    ],
    expected: ['3', '2'],
  });
});

test('a refused strike says so only while the strike is open; a lost answer always does', async () => {
  const id = 'a'.repeat(24);
  const form = (type: string, fields: Record<string, string> = {}) => {
    const posted = new FormData();
    for (const [name, value] of Object.entries({
      version: '1',
      commandId: id,
      expectedVersion: '3',
      type,
      participantId: id,
      ...fields,
    }))
      posted.set(name, value);
    return posted;
  };
  const strike = form('strike_resolution', { ordinal: '0', position: '1' });
  const refusedBy = async (posted: FormData, status = 409) =>
    submitRoundForm(async () => new Response('{}', { status }), id, posted);
  const refused = await refusedBy(strike);
  const yielded = await refusedBy(form('yield', { confirmed: 'true' }));
  const forbidden = await refusedBy(strike, 403);
  const lost = roundCommandUnavailable(strike);
  const opening = (step: 'strike' | 'prep') =>
    ({ opening: { step: { step } } }) as Parameters<typeof shownError>[1];
  assert({
    given:
      'a refused strike on the strike step, in prep and in the debate; a refused yield; and a strike whose answer was lost',
    should:
      'show the strike refusal only on the strike step, and the others wherever the round is',
    actual: [
      shownError(refused, opening('strike')),
      shownError(refused, opening('prep')),
      shownError(refused, { opening: null }),
      shownError(yielded, { opening: null }),
      shownError(lost, opening('prep')),
      shownError(forbidden, opening('prep')),
    ],
    expected: [
      'Someone struck first, or time ran out. Here is the draw now.',
      undefined,
      undefined,
      'The round changed or that action is no longer legal. Review the current round and try again.',
      'The command is not acknowledged. Review the current round before trying again.',
      undefined,
    ],
  });
  assert({
    given: 'a refusal on the strike step, and the same refusal once prep runs',
    should: 'focus the feedback only while it is shown',
    actual: [
      answerFocusTarget(refused, opening('strike'), 'feedback', 'control'),
      answerFocusTarget(refused, opening('prep'), 'feedback', 'control'),
    ],
    expected: ['feedback', 'control-strike_resolution'],
  });
  assert({
    given:
      'an answer settling once the post-round call has replaced the controls',
    should:
      'focus the result link that took their place, never a control that is gone',
    actual: answerFocusTarget(
      refused,
      opening('prep'),
      'feedback',
      'control',
      true,
    ),
    expected: 'round-call-result',
  });
});

const confirming = (asked: string) =>
  renderToStaticMarkup(
    <CommandForm
      intent={intent}
      commandId={'n'.repeat(24)}
      version={7}
      segment="2"
      post={() => undefined}
      answer={{
        kind: 'confirming',
        values: {
          type: 'yield',
          expectedVersion: '5',
          commandId: 'c'.repeat(24),
          segment: asked,
        },
      }}
      pending={false}
      control="control"
    />,
  ).includes('Confirm end speech');

test('a confirmation asked in one segment never ends the next (ISSUE-838)', () => {
  assert({
    given:
      'an End speech confirmation asked in segment 1 while the debater now holds segment 2, and one asked in segment 2',
    should:
      'offer a fresh End speech for the stale one and Confirm for the current one',
    actual: [confirming('1'), confirming('2')],
    expected: [false, true],
  });
});

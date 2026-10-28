import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
setupRitewayBun();
mockNextRouter();
const { CommandForm } = await import('./round-command-actions');

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
        values: {
          type: 'yield',
          expectedVersion: '2',
          commandId: 'c'.repeat(24),
        },
        confirmation: true,
      }),
      expectedVersion({
        values: {
          type: 'yield',
          expectedVersion: '2',
          commandId: 'c'.repeat(24),
        },
        unacknowledged: true,
      }),
    ],
    expected: ['3', '2'],
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
        values: {
          type: 'yield',
          expectedVersion: '5',
          commandId: 'c'.repeat(24),
          segment: asked,
        },
        confirmation: true,
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

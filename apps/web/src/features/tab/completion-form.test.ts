import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { completionEnvelope } from './completion-form';
setupRitewayBun();
test('completion forms preserve their rendered source guard and review target', () => {
  const base = {
    commandId: createId(),
    lobbyId: createId(),
    eventId: createId(),
    handle: 'actual-tournament',
  };
  for (const type of ['announce-break', 'certify-event'] as const) {
    const form = new FormData();
    form.set('eventId', createId());
    form.set('resultsVersion', '999');
    const command =
      type === 'announce-break'
        ? { type: 'announce-break' as const, eventId: base.eventId }
        : { type: 'certify-event' as const, eventId: base.eventId };
    const encoded = completionEnvelope(
      { ...base, target: { type, resultsVersion: 7 } },
      form,
    );
    assert({
      given: `a ${type} form with substituted addressing fields`,
      should: 'retain its rendered event, source guard and replay identity',
      actual: [
        encoded.version,
        encoded.commandId,
        encoded.expected,
        encoded.command,
      ],
      expected: [1, base.commandId, { results: 7 }, command],
    });
  }
  const ballotId = createId(),
    form = new FormData();
  form.set('mode', 'redacted');
  form.set('reason', 'Contact [removed]');
  form.set('feedback:affirmative', 'Clear delivery');
  form.set('feedback:foreign', 'Do not add a subject');
  form.set('ballotId', createId());
  assert({
    given: 'a held ballot review with edited fields and substituted targets',
    should:
      'publish only the explicitly reviewed written copy for that ballot without changing its source',
    actual: completionEnvelope(
      {
        ...base,
        target: {
          type: 'resolve-screening-hold',
          ballotId,
          roundId: createId(),
          feedbackKeys: ['affirmative'],
        },
      },
      form,
    ),
    expected: {
      version: 1,
      commandId: base.commandId,
      expected: {},
      command: {
        type: 'resolve-screening-hold',
        ballotId,
        release: {
          kind: 'redacted',
          text: {
            reason: 'Contact [removed]',
            feedback: { affirmative: 'Clear delivery' },
          },
        },
      },
    },
  });
});

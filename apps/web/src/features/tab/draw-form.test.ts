import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawFormEnvelope, drawFormAnswer } from './draw-form';
setupRitewayBun();
const id = (name: string) => name.padEnd(24, 'x');
test('Draw forms retain source identity and exact publication overrides', () => {
  const command = {
    type: 'publish-draw' as const,
    drawId: id('draw'),
    overrides: [],
  };
  const context = {
    handle: 'tournament',
    lobbyId: id('lobby'),
    eventId: id('event'),
    tabRoundId: id('round'),
    envelope: {
      version: 1 as const,
      commandId: id('command'),
      expected: { draw: 2, entries: 4, timeSlot: 3 },
      command,
    },
    overrideKeys: ['pairing.same_school' as const],
  };
  const form = new FormData();
  form.set('drawId', id('forged'));
  form.set('commandId', id('forgedcommand'));
  form.set('draw', '99');
  form.set(
    'override:pairing.same_school',
    'The two available teams share a school.',
  );
  form.set('override:pairing.rematch', 'unrendered rule');
  assert({
    given: 'edited hidden identity/guard fields and an unrendered rule',
    should:
      'retain the reviewed target and guards and accept only the rendered actual rule reason',
    actual: drawFormEnvelope(context, form),
    expected: {
      ...context.envelope,
      command: {
        ...command,
        overrides: [
          {
            key: 'pairing.same_school',
            reason: 'The two available teams share a school.',
          },
        ],
      },
    },
  });
});

test('a pending Draw change is acknowledged as pending', () => {
  const answer = drawFormAnswer(new FormData(), {
    kind: 'pending',
    pendingCommandId: id('pending'),
    expiresAt: '2026-11-16T12:00:00.000Z',
  });
  assert({
    given: 'a real pending-command response',
    should:
      'state that confirmation is awaited instead of claiming a lost response',
    actual: answer,
    expected: {
      kind: 'refused',
      values: {},
      error:
        'This change is awaiting confirmation by another authorized person.',
    },
  });
});

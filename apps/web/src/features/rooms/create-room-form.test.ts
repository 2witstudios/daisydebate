import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitRoomCreation } from './create-room-form';

setupRitewayBun();

const form = () => {
  const fields = new FormData();
  fields.set('commandId', 'h'.repeat(24));
  fields.set('title', 'My room');
  fields.set('topic', 'A real topic');
  fields.set('visibility', 'public');
  fields.set(
    'selection',
    JSON.stringify({
      kind: 'ranked',
      formatId: 'stored-format',
      formatVersion: 2,
      presetVersion: 3,
    }),
  );
  return fields;
};
const hydrated = new Headers({ 'next-action': 'action' });
const answer = (response: Response) =>
  submitRoomCreation(async () => response, hydrated, form());

test('creation refusals answer with what happened, and an active Room returns its member to it', async () => {
  const href = `/rounds/${'r'.repeat(24)}/room`;
  assert({
    given:
      'an already-in-a-room refusal naming the live Room, then forbidden, rate-limited and replayed refusals',
    should:
      'move the hydrated page to the current Room and give each other refusal its own message',
    actual: [
      await answer(
        Response.json(
          {
            refusal: 'active-room',
            activeRoom: {
              version: 1,
              id: 'm'.repeat(24),
              title: 'Current room',
              phase: 'live',
              role: 'debater',
              href,
            },
          },
          { status: 409 },
        ),
      ),
      ...(
        await Promise.all(
          [403, 429, 409].map((status) =>
            answer(new Response(null, { status })),
          ),
        )
      ).map((state) => state.error),
    ],
    expected: [
      { values: {}, next: href },
      'Your account cannot create rooms right now.',
      'You are creating rooms too quickly. Wait a moment and try again.',
      'This form was already sent. Reload the page and try again.',
    ],
  });
});

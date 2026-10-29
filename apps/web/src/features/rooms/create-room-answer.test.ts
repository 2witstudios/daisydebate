import { assert, setupRitewayBun, test } from 'riteway/bun';
import { postRoomDraft } from './create-room-answer';
setupRitewayBun();
test('draft transport retains edits on refusal, network failure and malformed navigation', async () => {
  const form = new FormData();
  form.set('title', 'Kept title');
  form.set('duration.segment.0', '4:32.123');
  const unavailable = await Promise.all([
    postRoomDraft(async () => {
      throw new Error('offline');
    }, form),
    postRoomDraft(async () => new Response(null, { status: 503 }), form),
    postRoomDraft(
      async () => Response.json({ values: {}, next: 'https://other.test' }),
      form,
    ),
  ]);
  const answer = {
    values: { title: 'Kept title' },
    error: 'Review your settings.',
  };
  const refused = await postRoomDraft(async () => Response.json(answer), form);
  assert({
    given: 'a posted draft and failed or invalid replies',
    should:
      'retain exact edits, refuse external navigation and preserve valid validation answers',
    actual: [unavailable.map((state) => state.values), refused],
    expected: [
      Array.from({ length: 3 }, () => ({
        title: 'Kept title',
        'duration.segment.0': '4:32.123',
      })),
      answer,
    ],
  });
});

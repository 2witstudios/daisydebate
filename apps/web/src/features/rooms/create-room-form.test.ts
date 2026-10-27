import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot, rankedCreateForm } from './assembly.test-support';
import { submitRoomCreation } from './create-room-form';

setupRitewayBun();

const form = () => rankedCreateForm('public');
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

test('the hook sees the Room its member reaches while it assembles, and never blocks reaching it', async () => {
  const seen: string[] = [];
  const held = 'h'.repeat(24);
  const activeRoom = (phase: 'assembling' | 'live', href: string) =>
    Response.json(
      {
        refusal: 'active-room',
        activeRoom: {
          version: 1,
          id: held,
          title: 'Current room',
          phase,
          role: 'host',
          href,
        },
      },
      { status: 409 },
    );
  const submit = (
    response: Response,
    hook: (roomId: string) => Promise<void>,
  ) =>
    submitRoomCreation(async () => response, hydrated, form(), undefined, hook);
  const record = async (roomId: string) => {
    seen.push(roomId);
  };
  const created = await submit(
    Response.json(
      { receipt: { roomId: assemblySnapshot.id }, view: assemblySnapshot },
      { status: 201 },
    ),
    async () => {
      throw new Error('delivery failed');
    },
  );
  await submit(activeRoom('assembling', `/rooms/${held}`), record);
  await submit(activeRoom('live', `/rounds/${'r'.repeat(24)}/room`), record);
  assert({
    given:
      'a created Room whose hook throws, then a held assembling Room, then a held live one',
    should:
      'still move on to the created Room, and hand the hook only the assembling Room',
    actual: [created.next, seen],
    expected: [`/rooms/${assemblySnapshot.id}`, [held]],
  });
});

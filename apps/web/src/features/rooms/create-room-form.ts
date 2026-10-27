import { createAssembly } from './create-assembly';
import { refused, type MockFormState } from '../mock-form/form';
import { moveOn } from '../../server/form-action';

/** The assembling Room an active-room answer names, if it is one. */
const assemblingRoomOf = (href: string) =>
  /^\/rooms\/([a-z0-9]{24})$/.exec(href)?.[1];

/**
 * `beforeMoveOn` is best effort: the Room exists either way, so a hook that
 * fails never keeps its member from moving on to it.
 */
async function runHook(
  hook: (roomId: string) => Promise<void>,
  roomId: string | undefined,
) {
  if (!roomId) return;
  try {
    await hook(roomId);
  } catch {
    // The Room's own invite link still reaches anyone the hook missed.
  }
}

/**
 * Normal creation and explicit rematch keep the same native/enhanced
 * acknowledgement behavior. `beforeMoveOn` runs with the Room its member
 * is about to reach while it still assembles: the one just created, or the
 * one they already hold (a Challenge records itself there).
 */
export async function submitRoomCreation(
  fetch: Parameters<typeof createAssembly>[0],
  incoming: Headers,
  form: unknown,
  path = '/api/rooms',
  beforeMoveOn: (roomId: string) => Promise<void> = async () => {},
): Promise<MockFormState> {
  const submitted = form instanceof FormData ? form : new FormData();
  const result = await createAssembly(
    (_, init) => fetch(path, init),
    submitted,
  );
  if (result.kind === 'created') {
    await runHook(beforeMoveOn, result.roomId);
    return { values: {}, ...moveOn(incoming, `/rooms/${result.roomId}`) };
  }
  // One active Room per user (ADR 0070): the answer is to go back to it.
  if (result.kind === 'active-room' && result.href) {
    await runHook(beforeMoveOn, assemblingRoomOf(result.href));
    return { values: {}, ...moveOn(incoming, result.href) };
  }
  return refused(submitted, creationRefusal(result));
}

const refusals = {
  settings:
    'The room could not be created. Review your settings and try again.',
  forbidden: 'Your account cannot create rooms right now.',
  'rate-limited':
    'You are creating rooms too quickly. Wait a moment and try again.',
  replayed: 'This form was already sent. Reload the page and try again.',
} as const;

function creationRefusal(
  result: Exclude<
    Awaited<ReturnType<typeof createAssembly>>,
    { kind: 'created' }
  >,
): string {
  if (result.kind === 'invalid')
    return 'Check the room name, resolution and format.';
  if (result.kind === 'active-room')
    return 'You are already in a room. Leave it before starting another.';
  if (result.kind === 'refused') return refusals[result.reason];
  return 'Room creation is unavailable. Try again.';
}

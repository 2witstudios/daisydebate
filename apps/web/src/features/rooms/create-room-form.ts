import { createAssembly } from './create-assembly';
import { refused, type MockFormState } from '../mock-form/form';
import { moveOn } from '../../server/form-action';

/**
 * Normal creation and explicit rematch keep the same native/enhanced
 * acknowledgement behavior. `afterCreate` runs once the Room exists and
 * before moving on to it (a Challenge records itself there).
 */
export async function submitRoomCreation(
  fetch: Parameters<typeof createAssembly>[0],
  incoming: Headers,
  form: unknown,
  path = '/api/rooms',
  afterCreate: (roomId: string) => Promise<void> = async () => {},
): Promise<MockFormState> {
  const submitted = form instanceof FormData ? form : new FormData();
  const result = await createAssembly(
    (_, init) => fetch(path, init),
    submitted,
  );
  if (result.kind === 'created') {
    await afterCreate(result.roomId);
    return { values: {}, ...moveOn(incoming, `/rooms/${result.roomId}`) };
  }
  // One active Room per user (ADR 0070): the answer is to go back to it.
  if (result.kind === 'active-room' && result.href)
    return { values: {}, ...moveOn(incoming, result.href) };
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

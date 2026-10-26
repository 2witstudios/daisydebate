import { createAssembly } from './create-assembly';
import { refused, type MockFormState } from '../mock-form/form';
import { moveOn } from '../../server/form-action';

/** Normal creation and explicit rematch keep the same native/enhanced acknowledgement behavior. */
export async function submitRoomCreation(
  fetch: Parameters<typeof createAssembly>[0],
  incoming: Headers,
  form: unknown,
  path = '/api/rooms',
): Promise<MockFormState> {
  const submitted = form instanceof FormData ? form : new FormData();
  const result = await createAssembly(
    (_, init) => fetch(path, init),
    submitted,
  );
  if (result.kind === 'created')
    return { values: {}, ...moveOn(incoming, `/rooms/${result.roomId}`) };
  return refused(
    submitted,
    result.kind === 'invalid'
      ? 'Check the room name, topic and format template.'
      : result.kind === 'refused'
        ? 'The room could not be created. Review your settings and try again.'
        : 'Room creation is unavailable. Try again.',
  );
}

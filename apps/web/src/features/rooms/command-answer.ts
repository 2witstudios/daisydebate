import { refused, type MockFormState } from '../mock-form/form';
import type { submitAssembly } from './submit-assembly';

export const commandUnavailable = (form: FormData): MockFormState =>
  refused(
    form,
    'The command is not acknowledged. Review the room and try again.',
  );

/** Navigation is selected only from the canonical response, never submitted Round IDs. */
export function commandAnswer(
  result: Awaited<ReturnType<typeof submitAssembly>>,
  roomId: string,
  form: FormData,
  move: (destination: string) => { readonly next: string },
): MockFormState {
  const destination =
    result.kind === 'accepted' &&
    form.get('type') === 'start-round' &&
    result.view.roundRef
      ? `/rounds/${result.view.roundRef.id}`
      : `/rooms/${roomId}${result.kind === 'accepted' ? '' : '?notice=command-refused'}`;
  return { values: {}, ...move(destination) };
}

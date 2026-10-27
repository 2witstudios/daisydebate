import type { RoomView } from '@daisy/protocol';
import { refused, type MockFormState } from '../mock-form/form';
import type { submitAssembly } from './submit-assembly';

/**
 * A room form's answer. A hydrated page gets the accepted canonical view and
 * hands it to room sync instead of navigating (ADR 0066).
 */
export type RoomFormState = MockFormState & { readonly view?: RoomView };

export const commandUnavailable = (form: FormData): MockFormState =>
  refused(
    form,
    'The command is not acknowledged. Review the room and try again.',
  );

const refusalMessage = (result: Awaited<ReturnType<typeof submitAssembly>>) =>
  result.kind === 'refused' && result.reason === 'version-conflict'
    ? 'The room changed. Review the latest room and try again.'
    : 'The command was not acknowledged. Review the current room and try again.';

/**
 * Navigation is selected only from the canonical response, never submitted
 * Round IDs. Launch always moves to its Round. Otherwise a hydrated page
 * stays put; a native post moves to the room (with a notice when refused).
 */
export function commandAnswer(
  result: Awaited<ReturnType<typeof submitAssembly>>,
  roomId: string,
  form: FormData,
  edge: {
    readonly hydrated: boolean;
    readonly move: (destination: string) => { readonly next: string };
  },
): RoomFormState {
  if (
    result.kind === 'accepted' &&
    form.get('type') === 'start-round' &&
    result.view.roundRef
  )
    return { values: {}, ...edge.move(`/rounds/${result.view.roundRef.id}`) };
  if (edge.hydrated)
    return result.kind === 'accepted'
      ? { values: {}, view: result.view }
      : refused(form, refusalMessage(result));
  return {
    values: {},
    ...edge.move(
      `/rooms/${roomId}${result.kind === 'accepted' ? '' : '?notice=command-refused'}#`,
    ),
  };
}

/** Room details/settings saves share the same native fragment-clearing answer. */
export function roomFormAnswer(
  result: Parameters<typeof commandAnswer>[0],
  form: FormData,
  edge: Parameters<typeof commandAnswer>[3],
): RoomFormState {
  if (result.kind === 'accepted')
    return edge.hydrated
      ? { values: {}, view: result.view }
      : { values: {}, ...edge.move(`/rooms/${result.view.id}#`) };
  return refused(
    form,
    result.kind === 'refused' && result.reason === 'version-conflict'
      ? 'The room changed. Review the latest room before saving.'
      : result.kind === 'unavailable'
        ? 'The update is not acknowledged. Try again.'
        : 'These changes were refused. Check the room settings.',
  );
}

import { refused, unacknowledged } from '../forms/form-state';
import type { RoomFormState } from './command-answer';
import { prepareSettings } from './prepare-settings';
import type { RoomRead } from './read-assembly';

/** The Room as a settings save reaches it: one fresh read, then one command. */
export type SettingsRoom = {
  readonly read: () => Promise<RoomRead>;
  readonly submit: (command: FormData) => Promise<RoomFormState>;
};

/**
 * Converts the posted settings against the fresh canonical Room, preserving
 * the submitted version fence, and posts the one command they make. The
 * answer is about the form as posted, not the command built from it.
 */
export async function saveSettings(
  room: SettingsRoom,
  form: FormData,
): Promise<RoomFormState> {
  const current = await room.read();
  if (current.kind !== 'found')
    return refused(form, 'Settings are unavailable. Try again.');
  const prepared = prepareSettings(current.view, form);
  if (prepared.kind !== 'prepared')
    return refused(
      form,
      prepared.kind === 'conflict'
        ? 'The room changed. Review the latest room before saving.'
        : 'These settings are not permitted. Check the values and try again.',
    );
  const command = new FormData();
  for (const [name, value] of Object.entries(prepared.command))
    command.set(
      name,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    );
  return aboutPosted(await room.submit(command), form);
}

function aboutPosted(answer: RoomFormState, form: FormData): RoomFormState {
  switch (answer.kind) {
    case 'refused':
      return refused(form, answer.error);
    case 'unacknowledged':
      return unacknowledged(form);
    case 'idle':
    case 'done':
    case 'moved':
    case 'accepted':
      return answer;
  }
}

'use server';

import {
  createdRoomPath,
  parseCreateRoom,
} from '../../../features/rooms/settings';
import type { MockFormState } from '../../../features/mock-form/form';
import { runMockForm } from '../../../server/mock-form-action';

/**
 * Opening a practice room, as a server action: it works before hydration and
 * without JavaScript. The form is read defensively and refused with what was
 * typed; an accepted room opens on its page.
 */
export async function createRoomAction(
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  return runMockForm(form, parseCreateRoom, createdRoomPath);
}

'use server';

import { systemClock } from '@daisy/clock';
import { getRoomInfo } from '../../../../features/rooms/get-room';
import { parseTimings } from '../../../../features/rooms/settings';
import {
  parseRoomState,
  roomHref,
  settingsSaved,
} from '../../../../features/rooms/state';
import type { MockFormState } from '../../../../features/mock-form/form';
import { runMockForm } from '../../../../server/mock-form-action';

/**
 * The host's timings form, as a server action: it works before hydration and
 * without JavaScript. `roomId` and `search` are bound from the page and come
 * back from the browser, so both are read defensively: an unknown room goes
 * to the lobby, and the state is parsed again, never trusted.
 */
export async function saveRoomSettingsAction(
  roomId: unknown,
  search: unknown,
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  const id = typeof roomId === 'string' ? roomId : '';
  const info = getRoomInfo(id, systemClock.now());
  const known = info !== null;
  const current = parseRoomState(
    id,
    Object.fromEntries(
      new URLSearchParams(typeof search === 'string' ? search : ''),
    ),
    info?.judge,
  );
  return runMockForm(form, parseTimings, () =>
    known ? roomHref(id, settingsSaved(current)) : '/lobby',
  );
}

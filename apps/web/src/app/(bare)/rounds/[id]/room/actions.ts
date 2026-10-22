'use server';
import { headers } from 'next/headers';
import { readNativeAttendanceState } from '../../../../../features/attendance/read-native';
import {
  submitRoundForm,
  type RoundFormState,
} from '../../../../../features/round-runtime/command-form';
import { hydratedPost, moveOn } from '../../../../../server/form-action';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
const commands = processRoute(
  (routes) => (request) =>
    routes.rounds.commands(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
/** Native posts use the same Origin/session/member/rate/actor/engine gates as JSON. */
export async function roundCommandAction(
  roundId: string,
  _state: RoundFormState,
  form: FormData,
): Promise<RoundFormState> {
  const incoming = new Headers(await headers());
  const answer = await submitRoundForm(
    inProcessFetch(commands, incoming),
    roundId,
    form,
  );
  if (answer.acknowledged && !hydratedPost(incoming))
    return { values: {}, ...moveOn(incoming, `/rounds/${roundId}/room`) };
  return answer;
}

const nativeState = processRoute(
  (routes) => (request) =>
    routes.attendance.readNativeState(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export async function readPersistedAttendance(roundId: string) {
  return readNativeAttendanceState(
    inProcessFetch(nativeState, new Headers(await headers())),
    roundId,
  );
}

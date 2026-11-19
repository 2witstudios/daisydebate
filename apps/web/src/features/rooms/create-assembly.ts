import { roomCreateSchema } from '@daisy/protocol';
import { field } from '../forms/form-state';
import { recordingPolicyFromBox } from './capture-form';
import {
  readRoomCreateAnswer,
  type RoomCreateAnswer,
} from './room-create-response';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Created = RoomCreateAnswer | { readonly kind: 'invalid' };

/** Native form input goes through CAP's schema and its canonical authenticated POST. */
export async function createAssembly(
  fetch: FetchLike,
  form: FormData,
): Promise<Created> {
  let selection: unknown;
  try {
    selection = JSON.parse(field(form, 'selection'));
  } catch {
    return { kind: 'invalid' };
  }
  if (
    field(form, 'competition') === 'ranked' &&
    selection &&
    typeof selection === 'object' &&
    'kind' in selection &&
    selection.kind === 'catalog'
  ) {
    const { formatId, formatVersion, presetVersion } = selection as Record<
      string,
      unknown
    >;
    selection = { kind: 'ranked', formatId, formatVersion, presetVersion };
  }
  const ranked =
    selection !== null &&
    typeof selection === 'object' &&
    'kind' in selection &&
    selection.kind === 'ranked';
  const recording = !ranked && field(form, 'recording') === 'on';
  // A ranked Round has no post-round call: its box is disabled, and a stale tick is dropped.
  const postRoundCall = !ranked && field(form, 'postRoundCall') === 'on';
  const parsed = roomCreateSchema.safeParse({
    commandId: field(form, 'commandId'),
    title: field(form, 'title'),
    resolution:
      field(form, 'resolutionMethod') === 'strike'
        ? { kind: 'strike' }
        : {
            kind: field(form, 'resolutionMethod'),
            text: field(form, 'customResolution'),
          },
    visibility: field(form, 'visibility'),
    selection,
    ...(recording ? { recordingPolicy: recordingPolicyFromBox('on') } : {}),
    ...(postRoundCall ? { postRoundCall: true } : {}),
    ...(form.getAll('holdSeatFor').length
      ? { holdSeatsFor: form.getAll('holdSeatFor') }
      : {}),
    ...(recording && field(form, 'noticeVersion')
      ? { noticeVersion: field(form, 'noticeVersion') }
      : {}),
    // Club staff's Lobby choice (ADR 0156); absent, the creator's own lobby.
    ...(field(form, 'lobby') ? { lobby: field(form, 'lobby') } : {}),
  });
  if (!parsed.success) return { kind: 'invalid' };
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    return await readRoomCreateAnswer(response);
  } catch {
    return { kind: 'unavailable' };
  }
}

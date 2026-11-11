import type { RoomRefusal, RoomView } from '@daisy/protocol';
import {
  blankFields,
  formFields,
  refused,
  unacknowledged,
  type FormFields,
  type FormState,
  type Moved,
  type Unacknowledged,
} from '../forms/form-state';
import { aiJudgePremiumText } from './ai-judge-copy';
import type { submitAssembly } from './submit-assembly';

/** The Room took the command and answered with its canonical view. */
export type RoomAccepted = {
  readonly kind: 'accepted';
  readonly view: RoomView;
};

/**
 * A room form's answer. A hydrated page gets the accepted canonical view and
 * hands it to room sync instead of navigating (ADR 0066). `done` is a post
 * that left nothing for sync to adopt. An answer that was lost is
 * `unacknowledged`: it keeps the original fields, whose command identifier
 * makes the retry safe.
 */
export type RoomFormState = FormState | RoomAccepted | Unacknowledged;

export const roomAccepted = (view: RoomView): RoomAccepted => ({
  kind: 'accepted',
  view,
});

/** The answer was lost in transport, a server fault or an unreadable reply. */
export const commandUnavailable = (form: FormData): RoomFormState =>
  unacknowledged(form);

/**
 * The Room answers a command identifier it has already recorded with that
 * command's receipt before it looks at the version, so the unchanged retry
 * confirms a recorded command and runs one that never arrived.
 */
const commandUnacknowledgedText =
  'This command may have been recorded. Retry it to find out: a recorded command is confirmed, not run twice.';

/**
 * An edit form stays open with what was typed. Saving it again unchanged is
 * the same retry; the room below shows whether the first save landed.
 */
const editUnacknowledgedText =
  'These changes may have been saved. Review the latest room before saving again.';

/** What a room command's controls render from each answer. */
export function roomFormFields(answer: RoomFormState): FormFields {
  switch (answer.kind) {
    case 'accepted':
      return blankFields;
    case 'unacknowledged':
      return { values: answer.values, error: commandUnacknowledgedText };
    case 'idle':
    case 'refused':
    case 'done':
    case 'moved':
      return formFields(answer);
  }
}

/** What a room edit form renders from each answer. */
export function roomEditFields(answer: RoomFormState): FormFields {
  return answer.kind === 'unacknowledged'
    ? { values: answer.values, error: editUnacknowledgedText }
    : roomFormFields(answer);
}

const refusalWords: Partial<Record<RoomRefusal, string>> = {
  'seat-unavailable':
    'That seat just went: someone has it, or it is held for another member.',
  'version-conflict': 'The room changed. Review the latest room and try again.',
  'format-unavailable':
    'That format is no longer offered. Choose from the list now.',
  'illegal-config':
    'Those settings don’t fit this format: a set resolution needs one written in; a strike takes none.',
  'not-ready': 'Everyone seated must be Ready first.',
  'readiness-unavailable':
    'Ready can’t be read right now. Try again in a moment.',
  'actor-ineligible': 'Someone in a seat can’t take part right now.',
  'draw-unavailable':
    'There aren’t enough resolutions to draw from. Choose another source or add lines.',
  'bots-busy': 'Bots are busy right now. Try again shortly.',
  'ai-judge-premium': aiJudgePremiumText,
  'capture-premium':
    'Broadcasting and recording a casual round come with a subscription.',
  'capture-host-limit':
    'You already have as many broadcast or recorded rounds running as one host can. Wait for one to finish, or turn this off.',
  'capture-capacity':
    'Every slot for broadcast and recorded casual rounds is busy. Try again shortly, or turn this off.',
  'broadcast-private': 'A private room can be recorded but not broadcast.',
  'content-waiver-required':
    'Sign this season’s ranked content waiver before Ready.',
  'capture-notice-changed':
    'The recording notice changed. Read it again before Ready.',
};

/** Why a room command was refused, in the room's words; generic when unknown. */
export const commandRefusalText = (reason: RoomRefusal | null): string =>
  (reason && refusalWords[reason]) ??
  'The room refused that command. Review the current room and try again.';

type Submitted = Awaited<ReturnType<typeof submitAssembly>>;
type Unaccepted = Exclude<Submitted, { readonly kind: 'accepted' }>;

/** What a native post returns to the room with: a closed vocabulary, never echoed text. */
export type RoomNotice =
  | { readonly kind: 'refused'; readonly reason: RoomRefusal | null }
  | { readonly kind: 'unacknowledged' };

/** A native post cannot keep its fields for a retry; the room it returns to is the record. */
export const roomNoticeText = (notice: RoomNotice): string =>
  notice.kind === 'unacknowledged'
    ? 'That command may have been recorded. Review the room before trying again.'
    : commandRefusalText(notice.reason);

export const commandRefusedNotice = 'command-refused';
export const commandUnacknowledgedNotice = 'command-unacknowledged';

const noticeOf = (result: Unaccepted): RoomNotice =>
  result.kind === 'unavailable'
    ? { kind: 'unacknowledged' }
    : {
        kind: 'refused',
        reason: result.kind === 'refused' ? result.reason : null,
      };

export const roomNoticeQuery = (notice: RoomNotice) =>
  notice.kind === 'unacknowledged'
    ? `?notice=${commandUnacknowledgedNotice}`
    : `?notice=${commandRefusedNotice}${notice.reason ? `&reason=${notice.reason}` : ''}`;

/** A hydrated page keeps what was posted, with the refusal or for the retry. */
const unaccepted = (result: Unaccepted, form: FormData): RoomFormState => {
  const notice = noticeOf(result);
  return notice.kind === 'unacknowledged'
    ? unacknowledged(form)
    : refused(form, commandRefusalText(notice.reason));
};

/**
 * Navigation is selected only from the canonical response, never submitted
 * Round IDs. Launch always moves to its Round. Otherwise a hydrated page
 * stays put; a native post moves to the room (with a notice unless accepted).
 */
export function commandAnswer(
  result: Submitted,
  roomId: string,
  form: FormData,
  edge: {
    readonly hydrated: boolean;
    readonly move: (destination: string) => Moved;
  },
): RoomFormState {
  if (result.kind !== 'accepted')
    return edge.hydrated
      ? unaccepted(result, form)
      : edge.move(`/rooms/${roomId}${roomNoticeQuery(noticeOf(result))}#`);
  if (form.get('type') === 'start-round' && result.view.roundRef)
    return edge.move(`/rounds/${result.view.roundRef.id}`);
  return edge.hydrated
    ? roomAccepted(result.view)
    : edge.move(`/rooms/${roomId}#`);
}

/** Room details/settings saves share the same native fragment-clearing answer. */
export function roomFormAnswer(
  result: Parameters<typeof commandAnswer>[0],
  form: FormData,
  edge: Parameters<typeof commandAnswer>[3],
): RoomFormState {
  if (result.kind === 'accepted')
    return edge.hydrated
      ? roomAccepted(result.view)
      : edge.move(`/rooms/${result.view.id}#`);
  if (result.kind === 'unavailable') return unacknowledged(form);
  return refused(
    form,
    result.kind === 'refused' && result.reason === 'version-conflict'
      ? 'The room changed. Review the latest room before saving.'
      : 'These changes were refused. Check the room settings.',
  );
}

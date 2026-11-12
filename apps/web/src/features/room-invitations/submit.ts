import type { RoomInvitationRefusal, RoomSeatKind } from '@daisy/protocol';
import {
  idle,
  refusedWith,
  type Idle,
  type Refused,
} from '../forms/form-state';

/** The invitation was sent, withdrawn or declined; `notice` says which. */
type InvitationAccepted = {
  readonly kind: 'accepted';
  readonly notice: string;
};

/**
 * What an invitation form answers with. A refused invite keeps what the host
 * chose in `values.username` and `values.seat`; withdraw and decline have
 * nothing to keep.
 */
export type InvitationFormState = Idle | Refused | InvitationAccepted;

export const initialInvitationForm: InvitationFormState = idle();

const accepted = (notice: string): InvitationAccepted => ({
  kind: 'accepted',
  notice,
});

const failed = 'That did not work. Try again.';

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

type InviteChoice = {
  readonly username: string;
  readonly seat: RoomSeatKind;
};

/** The member and seat kind an invite form names. */
const inviteChoice = (form: FormData): InviteChoice => ({
  username: text(form, 'username').replace(/^@/, ''),
  seat: text(form, 'seat') === 'judge' ? 'judge' : 'debater',
});

/** What a refusal hands back to be shown again: an invite's choice, else nothing. */
const kept = (form: FormData): Partial<InviteChoice> =>
  text(form, 'intent') === 'invite' ? inviteChoice(form) : {};

/**
 * The answer when the call never arrived or the form named no known intent.
 * An invite keeps the username and seat the host chose.
 */
export const invitationFormUnavailable = (
  form: FormData,
): InvitationFormState => refusedWith(kept(form), failed);

/**
 * What an invitation form renders: the username to keep in the field, the
 * seat kind to keep chosen, the notice beside them, and a key that changes
 * when an accepted invite should empty the field.
 */
export type InvitationFields = {
  readonly username: string;
  readonly seat: RoomSeatKind;
  readonly notice: string | undefined;
  readonly fieldKey: string;
};

export function invitationFields(
  answer: InvitationFormState,
): InvitationFields {
  switch (answer.kind) {
    case 'idle':
      return {
        username: '',
        seat: 'debater',
        notice: undefined,
        fieldKey: 'draft',
      };
    case 'refused':
      return {
        username: answer.values['username'] ?? '',
        seat: answer.values['seat'] === 'judge' ? 'judge' : 'debater',
        notice: answer.error,
        fieldKey: 'draft',
      };
    case 'accepted':
      return {
        username: '',
        seat: 'debater',
        notice: answer.notice,
        fieldKey: answer.notice,
      };
  }
}

const refusalWords: Record<RoomInvitationRefusal, string> = {
  'not-host': 'Only the host can do that.',
  'room-not-assembling': 'This room is no longer gathering players.',
  'member-unknown': 'No member has that username.',
  'member-unavailable': 'That member cannot be invited.',
  'already-seated': 'That member is already in a seat.',
  'already-invited': 'That member is already invited to the other seat.',
  'no-free-seat': 'There is no free seat of that kind left to hold.',
  'invitation-ended': 'That invitation has already ended.',
};

type Post = (path: string, body: unknown) => Promise<Response>;

/**
 * Sends one invitation form (ADR 0124): `intent` is invite, withdraw or
 * decline. A refusal answers in words from its closed reason; any other
 * failure says only that it did not work.
 */
export async function submitInvitationForm(
  post: Post,
  roomId: string,
  form: FormData,
): Promise<InvitationFormState> {
  const intent = text(form, 'intent');
  const { username, seat } = inviteChoice(form);
  const request =
    intent === 'invite'
      ? post(`/api/rooms/${encodeURIComponent(roomId)}/invitations`, {
          version: 1,
          username,
          seat,
        })
      : intent === 'withdraw' || intent === 'decline'
        ? post(`/api/room-invitations/${intent}`, {
            version: 1,
            invitationId: text(form, 'invitationId'),
          })
        : null;
  if (!request) return invitationFormUnavailable(form);
  try {
    const response = await request;
    if (response.ok)
      return accepted(
        intent === 'invite'
          ? `Invited @${username}. Their seat is held for them.`
          : intent === 'withdraw'
            ? 'Invitation withdrawn.'
            : 'Invitation declined.',
      );
    const body = (await response.json().catch(() => null)) as {
      refusal?: unknown;
    } | null;
    const refusal = body?.refusal;
    const words =
      typeof refusal === 'string' && refusal in refusalWords
        ? refusalWords[refusal as RoomInvitationRefusal]
        : response.status === 429
          ? 'Too many invitations. Try again later.'
          : response.status === 400
            ? 'Enter a username.'
            : failed;
    return refusedWith(kept(form), words);
  } catch {
    return invitationFormUnavailable(form);
  }
}

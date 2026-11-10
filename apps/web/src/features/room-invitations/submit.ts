import type { RoomInvitationRefusal } from '@daisy/protocol';

/** What an invitation form answers with: a notice, and whether it worked. */
export type InvitationFormState = {
  readonly notice?: string;
  readonly ok?: boolean;
  /** The username to keep in the field after a refusal. */
  readonly username?: string;
};

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

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
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
  const username = text(form, 'username').replace(/^@/, '');
  const request =
    intent === 'invite'
      ? post(`/api/rooms/${encodeURIComponent(roomId)}/invitations`, {
          version: 1,
          username,
          seat: text(form, 'seat') === 'judge' ? 'judge' : 'debater',
        })
      : intent === 'withdraw' || intent === 'decline'
        ? post(`/api/room-invitations/${intent}`, {
            version: 1,
            invitationId: text(form, 'invitationId'),
          })
        : null;
  if (!request) return { notice: 'That did not work. Try again.' };
  try {
    const response = await request;
    if (response.ok)
      return {
        ok: true,
        notice:
          intent === 'invite'
            ? `Invited @${username}. Their seat is held for them.`
            : intent === 'withdraw'
              ? 'Invitation withdrawn.'
              : 'Invitation declined.',
      };
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
            : 'That did not work. Try again.';
    return { notice: words, ...(intent === 'invite' ? { username } : {}) };
  } catch {
    return { notice: 'That did not work. Try again.' };
  }
}

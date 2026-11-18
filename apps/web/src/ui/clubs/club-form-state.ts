import {
  done,
  field,
  formFields,
  idle,
  refused,
  unacknowledged,
  type Done,
  type FormFields,
  type Idle,
  type Moved,
  type Refused,
  type Unacknowledged,
} from '../../features/forms/form-state';
import { refusalText } from './club-copy';

/** Every club form's answer: the shared vocabulary, nothing of its own. */
export type ClubFormState = Idle | Refused | Done | Moved | Unacknowledged;
export const initialClubForm: ClubFormState = idle();
/** The answer was lost: the form keeps what was typed for a retry. */
export const clubFormUnavailable = (form: FormData): ClubFormState =>
  unacknowledged(form);
export const clubFields = (state: ClubFormState): FormFields =>
  formFields(state);

/** A club route's JSON answer as form state: changed is done, anything else refused. */
export function clubAnswer(form: FormData, body: unknown): ClubFormState {
  const answer =
    typeof body === 'object' && body !== null
      ? (body as { kind?: unknown; reason?: unknown; refusal?: unknown })
      : {};
  if (answer.kind === 'changed') return done();
  if (answer.kind === 'refused')
    return refused(form, refusalText(answer.reason ?? answer.refusal));
  return refused(form, refusalText(answer.kind));
}

/** What a seats-board form posts, read from its fields; null when it cannot be valid. */
export function seatCommandFrom(form: FormData): unknown {
  const kind = field(form, 'kind');
  switch (kind) {
    case 'invite':
      return field(form, 'email')
        ? { kind, email: field(form, 'email') }
        : null;
    case 'assign':
    case 'remove':
      return { kind, userId: field(form, 'userId') };
    case 'cancel':
    case 'resend':
      return { kind, invitationId: field(form, 'invitationId') };
    case 'move': {
      const to = field(form, 'to');
      if (to === 'invite')
        return field(form, 'email')
          ? {
              kind,
              fromUserId: field(form, 'fromUserId'),
              to: { kind: 'invite', email: field(form, 'email') },
            }
          : null;
      return to
        ? {
            kind,
            fromUserId: field(form, 'fromUserId'),
            to: { kind: 'member', userId: to },
          }
        : null;
    }
    default:
      return null;
  }
}

/** A seat-count change: the count and exactly the seats and invitations chosen to give up. */
export function seatCountFrom(form: FormData): unknown {
  const seatCount = Number(field(form, 'seatCount'));
  if (!Number.isInteger(seatCount)) return null;
  const all = (key: string) =>
    form
      .getAll(key)
      .filter((value): value is string => typeof value === 'string');
  return {
    seatCount,
    release: {
      seats: all('releaseSeat'),
      invitations: all('releaseInvitation'),
    },
  };
}

/** A club's handle from its name: lower-case words joined by hyphens, 3 to 40 characters. */
export function handleFrom(
  name: string,
  attempt: number,
  /** Six random lower-case letters or digits, from the caller. */
  random: string,
): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  // A name with no Latin letters or digits (Chinese, Arabic, emoji) has no
  // slug; it, and every later retry, takes a random suffix so handles never run out.
  if (slug === '' || attempt >= 2) return `${slug || 'club'}-${random}`;
  const padded = slug.length < 3 ? `${slug}-club` : slug;
  return attempt === 0 ? padded : `${padded}-${attempt + 1}`;
}

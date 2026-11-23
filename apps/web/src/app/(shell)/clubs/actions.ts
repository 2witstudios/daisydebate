'use server';
import { createId } from '@paralleldrive/cuid2';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { field, refused } from '../../../features/forms/form-state';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import {
  clubAnswer,
  clubFormUnavailable,
  handleFrom,
  seatCommandFrom,
  seatCountFrom,
  type ClubFormState,
} from '../../../ui/clubs/club-form-state';
import { refusalCopy } from '../../../ui/clubs/club-copy';
import { POST as createRoute } from '../../api/clubs/route';
import { POST as seatsRoute } from '../../api/clubs/[club]/seats/route';
import { POST as seatCountRoute } from '../../api/clubs/[club]/billing/seats/route';
import { POST as invitationRoute } from '../../api/clubs/invitations/[invitation]/route';

const clubId = /^[a-z0-9]{24}$/;
const invitationRef = /^[a-z0-9]{24}\.[a-z0-9]{24}$/;

/** Posts as this request, through the route a script would call. */
async function postJson(
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
) {
  const incoming = new Headers(await headers());
  const response = await inProcessFetch(route, incoming)(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { incoming, response };
}

/** A seats-board command (invite, assign, move, remove, resend, cancel). */
export async function clubSeatAction(
  club: string,
  _previous: ClubFormState,
  form: FormData,
): Promise<ClubFormState> {
  if (!clubId.test(club)) return refused(form, refusalCopy.unavailable);
  const command = seatCommandFrom(form);
  if (command === null)
    return refused(form, 'Enter an email address or choose who gets the seat.');
  try {
    const { response } = await postJson(
      (request) => seatsRoute(request, { params: Promise.resolve({ club }) }),
      `/api/clubs/${club}/seats`,
      command,
    );
    if (response.status === 400)
      return refused(form, 'Check the email address and try again.');
    if (!response.ok)
      return response.status >= 500
        ? clubFormUnavailable(form)
        : refused(form, refusalCopy.unavailable);
    const answer = clubAnswer(form, await response.json());
    if (answer.kind === 'done') revalidatePath(`/clubs/${club}/seats`);
    return answer;
  } catch {
    return clubFormUnavailable(form);
  }
}

/** Change the seat count: an increase is paid now, a decrease gives up the chosen seats. */
export async function clubSeatCountAction(
  club: string,
  _previous: ClubFormState,
  form: FormData,
): Promise<ClubFormState> {
  if (!clubId.test(club)) return refused(form, refusalCopy.unavailable);
  const change = seatCountFrom(form);
  if (change === null)
    return refused(form, refusalCopy['seat-count-out-of-range']);
  try {
    const { response } = await postJson(
      (request) =>
        seatCountRoute(request, { params: Promise.resolve({ club }) }),
      `/api/clubs/${club}/billing/seats`,
      change,
    );
    if (response.status === 400)
      return refused(form, refusalCopy['seat-count-out-of-range']);
    if (!response.ok)
      return response.status >= 500
        ? clubFormUnavailable(form)
        : refused(form, refusalCopy.unavailable);
    const answer = clubAnswer(form, await response.json());
    if (answer.kind === 'done') {
      revalidatePath(`/clubs/${club}/billing`);
      revalidatePath(`/clubs/${club}/seats`);
    }
    return answer;
  } catch {
    return clubFormUnavailable(form);
  }
}

/** Start a club: the organisation, then Checkout for its seats. */
export async function startClubAction(
  _previous: ClubFormState,
  form: FormData,
): Promise<ClubFormState> {
  const name = field(form, 'name');
  const choice = field(form, 'kind');
  const seats = Number(field(form, 'seats'));
  if (name.length < 2 || name.length > 80)
    return refused(form, 'Enter a club name of 2 to 80 characters.');
  if (!['school', 'club', 'family'].includes(choice))
    return refused(form, 'Choose what kind of club this is.');
  if (!Number.isInteger(seats) || seats < 1 || seats > 200)
    return refused(form, refusalCopy['seat-count-out-of-range']);
  // The board's "Club" is the school kind: a school team or debate club.
  const kind = choice === 'family' ? 'family' : 'school';
  let created: { incoming: Headers; location: string } | null = null;
  try {
    for (let attempt = 0; attempt < 5 && created === null; attempt += 1) {
      const { incoming, response } = await postJson(createRoute, '/api/clubs', {
        kind,
        name,
        handle: handleFrom(name, attempt, createId().slice(0, 6)),
        seats,
      });
      if (response.status === 404)
        return refused(form, refusalCopy['not-allowed']);
      if (!response.ok)
        return response.status >= 500
          ? clubFormUnavailable(form)
          : refused(form, 'Check the club name and seats, then try again.');
      const answer = (await response.json()) as {
        kind?: string;
        refusal?: string;
        location?: string;
      };
      if (answer.kind === 'created' && typeof answer.location === 'string')
        created = { incoming, location: answer.location };
      else if (answer.kind !== 'refused' || answer.refusal !== 'handle-taken')
        return refused(form, refusalCopy['not-allowed']);
    }
  } catch {
    return clubFormUnavailable(form);
  }
  if (created === null) return refused(form, refusalCopy['handle-taken']);
  // Stripe Checkout, or the club's billing page when Checkout is pending.
  return moveOn(created.incoming, created.location);
}

/** The invitee accepts or declines their seat. */
export async function clubInvitationAction(
  invitation: string,
  _previous: ClubFormState,
  form: FormData,
): Promise<ClubFormState> {
  const answer = field(form, 'answer');
  if (
    !invitationRef.test(invitation) ||
    !['accept', 'decline'].includes(answer)
  )
    return refused(form, refusalCopy.unavailable);
  let incoming: Headers;
  try {
    const posted = await postJson(
      (request) =>
        invitationRoute(request, { params: Promise.resolve({ invitation }) }),
      `/api/clubs/invitations/${invitation}`,
      { answer },
    );
    incoming = posted.incoming;
    const { response } = posted;
    if (!response.ok)
      return response.status >= 500
        ? clubFormUnavailable(form)
        : refused(form, refusalCopy['invitation-not-found']);
    const state = clubAnswer(form, await response.json());
    if (state.kind !== 'done') return state;
  } catch {
    return clubFormUnavailable(form);
  }
  revalidatePath('/settings/billing');
  return moveOn(incoming, answer === 'accept' ? '/settings/billing' : '/');
}

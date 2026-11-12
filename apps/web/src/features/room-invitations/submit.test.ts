import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialInvitationForm,
  invitationFields,
  invitationFormUnavailable,
  submitInvitationForm,
} from './submit';

setupRitewayBun();

const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

test('submitInvitationForm', async () => {
  const posted: unknown[] = [];
  const ok = async (path: string, body: unknown) => {
    posted.push([path, body]);
    return Response.json({ version: 1 });
  };
  const refused = async () =>
    Response.json({ refusal: 'no-free-seat' }, { status: 409 });
  assert({
    given: 'an invite to judge, a withdrawal and a refused invite',
    should: 'post each to its route and answer in words',
    actual: [
      await submitInvitationForm(
        ok,
        'room1',
        formOf({ intent: 'invite', username: '@coach', seat: 'judge' }),
      ),
      await submitInvitationForm(
        ok,
        'room1',
        formOf({ intent: 'withdraw', invitationId: 'inv1' }),
      ),
      await submitInvitationForm(
        refused,
        'room1',
        formOf({ intent: 'invite', username: 'coach', seat: 'judge' }),
      ),
      posted,
    ],
    expected: [
      {
        kind: 'accepted',
        notice: 'Invited @coach. Their seat is held for them.',
      },
      { kind: 'accepted', notice: 'Invitation withdrawn.' },
      {
        kind: 'refused',
        values: { username: 'coach', seat: 'judge' },
        error: 'There is no free seat of that kind left to hold.',
      },
      [
        [
          '/api/rooms/room1/invitations',
          { version: 1, username: 'coach', seat: 'judge' },
        ],
        [
          '/api/room-invitations/withdraw',
          { version: 1, invitationId: 'inv1' },
        ],
      ],
    ],
  });
});

test('an invitation answer is exactly one kind for each way a post can end', async () => {
  const answering =
    (response: () => Response | Promise<Response>) => async () =>
      response();
  const invite = formOf({
    intent: 'invite',
    username: 'coach',
    seat: 'debater',
  });
  const outcomes = {
    invited: await submitInvitationForm(
      answering(() => Response.json({ version: 1 })),
      'room1',
      invite,
    ),
    declined: await submitInvitationForm(
      answering(() => Response.json({ version: 1 })),
      'room1',
      formOf({ intent: 'decline', invitationId: 'inv1' }),
    ),
    inviteRefused: await submitInvitationForm(
      answering(() =>
        Response.json({ refusal: 'already-seated' }, { status: 409 }),
      ),
      'room1',
      invite,
    ),
    withdrawRefused: await submitInvitationForm(
      answering(() =>
        Response.json({ refusal: 'invitation-ended' }, { status: 409 }),
      ),
      'room1',
      formOf({ intent: 'withdraw', invitationId: 'inv1' }),
    ),
    limited: await submitInvitationForm(
      answering(() => new Response('{}', { status: 429 })),
      'room1',
      invite,
    ),
    unreachable: await submitInvitationForm(
      answering(() => Promise.reject(new Error('down'))),
      'room1',
      invite,
    ),
    unknownIntent: await submitInvitationForm(
      answering(() => Response.json({ version: 1 })),
      'room1',
      formOf({ intent: 'promote' }),
    ),
    neverArrived: invitationFormUnavailable(
      formOf({ intent: 'invite', username: '@coach', seat: 'judge' }),
    ),
    endNeverArrived: invitationFormUnavailable(
      formOf({ intent: 'withdraw', invitationId: 'inv1' }),
    ),
  };
  assert({
    given:
      'an invite and a decline that worked, an invite and a withdrawal the Room refused, a rate limit, a route that threw, an unknown intent and a call that never arrived',
    should:
      'answer accepted with its words, or refused with its words and the username and seat only where an invite has them to keep, a lost call included',
    actual: outcomes,
    expected: {
      invited: {
        kind: 'accepted',
        notice: 'Invited @coach. Their seat is held for them.',
      },
      declined: { kind: 'accepted', notice: 'Invitation declined.' },
      inviteRefused: {
        kind: 'refused',
        values: { username: 'coach', seat: 'debater' },
        error: 'That member is already in a seat.',
      },
      withdrawRefused: {
        kind: 'refused',
        values: {},
        error: 'That invitation has already ended.',
      },
      limited: {
        kind: 'refused',
        values: { username: 'coach', seat: 'debater' },
        error: 'Too many invitations. Try again later.',
      },
      unreachable: {
        kind: 'refused',
        values: { username: 'coach', seat: 'debater' },
        error: 'That did not work. Try again.',
      },
      unknownIntent: {
        kind: 'refused',
        values: {},
        error: 'That did not work. Try again.',
      },
      neverArrived: {
        kind: 'refused',
        values: { username: 'coach', seat: 'judge' },
        error: 'That did not work. Try again.',
      },
      endNeverArrived: {
        kind: 'refused',
        values: {},
        error: 'That did not work. Try again.',
      },
    },
  });
});

test('what the invite form shows follows from the one kind it was answered with', () => {
  assert({
    given: 'no post yet, a refused invite and an accepted one',
    should:
      'start empty as a debater, keep the refused username and seat beside the reason, and empty the field under a new key once accepted',
    actual: [
      invitationFields(initialInvitationForm),
      invitationFields({
        kind: 'refused',
        values: { username: 'coach', seat: 'judge' },
        error: 'That member cannot be invited.',
      }),
      invitationFields({ kind: 'accepted', notice: 'Invitation withdrawn.' }),
    ],
    expected: [
      { username: '', seat: 'debater', notice: undefined, fieldKey: 'draft' },
      {
        username: 'coach',
        seat: 'judge',
        notice: 'That member cannot be invited.',
        fieldKey: 'draft',
      },
      {
        username: '',
        seat: 'debater',
        notice: 'Invitation withdrawn.',
        fieldKey: 'Invitation withdrawn.',
      },
    ],
  });
});

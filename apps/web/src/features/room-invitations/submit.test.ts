import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitInvitationForm } from './submit';

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
      { ok: true, notice: 'Invited @coach. Their seat is held for them.' },
      { ok: true, notice: 'Invitation withdrawn.' },
      {
        notice: 'There is no free seat of that kind left to hold.',
        username: 'coach',
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

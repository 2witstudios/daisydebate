import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createRefusal } from '@daisy/errors';
import type { RoomInvitationRefusal } from '@daisy/protocol';
import { noopErrorReporter } from '@daisy/observability';
import { origin } from '../../server/member-boundary.test-support';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createRoomInvitationHandlers } from './handlers';
import { submitInvitationForm } from './submit';

setupRitewayBun();

const ROOM = 'roomroomroomroomroomroom';
const INVITATION = 'invitationinvitationinvi';
const principal = { kind: 'user' as const, userId: 'host', actorId: 'actor' };
const member: Identity = { state: 'member', username: 'coach', principal };

/** The real handlers behind the form's own `post`, as the browser reaches them. */
const wired = (refuse?: RoomInvitationRefusal) => {
  const calls: unknown[] = [];
  const handlers = createRoomInvitationHandlers({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member,
      limiter: () => ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }),
    },
    invite: async (caller, input) => {
      calls.push(['invite', caller.actorId, input]);
      if (refuse) throw createRefusal('CONFLICT', refuse);
      return { invitationId: INVITATION };
    },
    end: async (caller, input) => {
      calls.push(['end', caller.actorId, input]);
      return { roomId: ROOM };
    },
  });
  const post = (path: string, body: unknown) => {
    const request = new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (path === `/api/rooms/${ROOM}/invitations`)
      return handlers.invite(request, ROOM);
    if (path === '/api/room-invitations/decline')
      return handlers.end(request, 'decline');
    if (path === '/api/room-invitations/withdraw')
      return handlers.end(request, 'withdraw');
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  return { calls, post };
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

test('the Invite form reaches the invite route', async () => {
  const { calls, post } = wired();
  const state = await submitInvitationForm(
    post,
    ROOM,
    form({ intent: 'invite', username: '@coach_b', seat: 'judge' }),
  );
  assert({
    given: 'the host’s Invite form naming a member as judge',
    should: 'pass the route’s schema and invite them, as the host',
    actual: { state, calls },
    expected: {
      state: {
        ok: true,
        notice: 'Invited @coach_b. Their seat is held for them.',
      },
      calls: [
        [
          'invite',
          'actor',
          { roomId: ROOM, username: 'coach_b', seat: 'judge' },
        ],
      ],
    },
  });
});

test('a refused invite answers in words', async () => {
  const { post } = wired('no-free-seat');
  const state = await submitInvitationForm(
    post,
    ROOM,
    form({ intent: 'invite', username: 'coach_b', seat: 'debater' }),
  );
  assert({
    given: 'an invite the Room refuses with a closed reason',
    should: 'come back as a notice, not a success',
    actual: state.ok ?? false,
    expected: false,
  });
});

test('the Decline and Withdraw buttons reach their routes', async () => {
  const { calls, post } = wired();
  for (const intent of ['decline', 'withdraw'])
    await submitInvitationForm(
      post,
      ROOM,
      form({ intent, invitationId: INVITATION }),
    );
  assert({
    given: 'the invitee’s Decline and the host’s Withdraw',
    should: 'pass each route’s schema and end the invitation that way',
    actual: calls,
    expected: [
      ['end', 'actor', { invitationId: INVITATION, end: 'decline' }],
      ['end', 'actor', { invitationId: INVITATION, end: 'withdraw' }],
    ],
  });
});

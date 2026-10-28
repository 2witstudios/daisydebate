import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { messagingTestGroupPolicy } from '@daisy/auth/testing';
import { betaMessagingPolicy } from './beta-policy';
import { composeMessagingRoutes } from './composition';
import { createMessagingUnitApp } from './messaging-app.test-support';
import { signedMessagingAuth } from './signed-messaging.test-support';

setupRitewayBun();

test('beta refuses every private-group creation, invitation and admission route, even with an approved group policy (ISSUE-643)', async () => {
  const { auth, cookie } = await signedMessagingAuth(
    'a'.repeat(24),
    'groups-off@daisy.example.com',
  );
  const withGroupPolicy = {
    ...betaMessagingPolicy,
    groupPosting: messagingTestGroupPolicy,
    social: {
      ...betaMessagingPolicy.social,
      groupAdmission: messagingTestGroupPolicy,
      groupInvitationLimits: { maxMembers: 12, maxPendingInvitations: 10 },
    },
  };
  const app = createMessagingUnitApp({
    clock: fixedClock('2026-10-27T12:00:00.000Z'),
    ids: sequentialId('groups-off'),
    messagingPolicy: withGroupPolicy,
  });
  // Every refusal must come before the unreachable database and Redis.
  const routes = composeMessagingRoutes({ ...app, auth: () => auth });
  const optedIn = composeMessagingRoutes({
    ...app,
    auth: () => auth,
    messagingPolicy: {
      ...withGroupPolicy,
      privateGroups: 'isolated-test-fixture',
    },
  });
  const origin = auth.config.PUBLIC_APP_URL;
  const post = (body: unknown) =>
    new Request(`${origin}/api/messaging`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const scoped = {
    version: 1,
    requestId: 'r'.repeat(24),
    channelId: 'c'.repeat(24),
  };
  try {
    const creation = {
      version: 1,
      requestId: 'r'.repeat(24),
      title: 'Group',
      invitedActorIds: ['b'.repeat(24)],
    };
    const statuses = [
      (await routes.createGroup(post(creation))).status,
      (
        await routes.createGroupByUsername(
          post({
            version: 1,
            requestId: 'r'.repeat(24),
            title: 'Group',
            invitedUsernames: ['bea'],
          }),
        )
      ).status,
      (await routes.inviteGroup(post({ ...scoped, invitedUsernames: ['bea'] })))
        .status,
      (
        await routes.decideGroupInvitation(
          post({ ...scoped, expectedGeneration: 1, decision: 'accept' }),
        )
      ).status,
    ];
    assert({
      given:
        'a signed-in member and the beta policy with an approved group policy supplied',
      should:
        'refuse creation by id and by username, invitation and acceptance alike',
      actual: statuses,
      expected: [403, 403, 403, 403],
    });
    assert({
      given: 'a decline of a group invitation while groups are off',
      should:
        'pass the gate (only acceptance admits) and fail only at the unreachable database (500)',
      actual: (
        await routes.decideGroupInvitation(
          post({ ...scoped, expectedGeneration: 1, decision: 'decline' }),
        )
      ).status,
      expected: 500,
    });
    assert({
      given: 'the same request under an isolated composition that opts in',
      should:
        'pass the gate and fail only at the unreachable database (500) instead',
      actual: (await optedIn.createGroup(post(creation))).status,
      expected: 500,
    });
  } finally {
    await app.close();
  }
});

import { test, expect } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createTestApp, testDatabaseUrl } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

test('deployed staging routes preserve invitation privacy, all-pairs admission and member revocation', async () => {
  const f = createTestApp({ MESSAGING_PRIVATE_GROUPS: 'staging' });
  const flows = createAccountFlows(f);
  const members = [];
  for (let index = 0; index < 3; index += 1) {
    const account = await flows.signUp();
    const username = uniqueName();
    expect((await flows.claim(account.cookie, { username })).status).toBe(201);
    const identity = await flows.identifyAs(account.cookie);
    if (identity.state !== 'member' || !identity.principal.actorId)
      throw new Error('Member required');
    members.push({ ...account, username, actorId: identity.principal.actorId });
  }
  const [manager, peer, outsider] = members;
  if (!manager || !peer || !outsider) throw new Error('Cast required');
  const post = (member: typeof manager, body: unknown) =>
    f.jsonPost('/api/messaging', body, { cookie: member.cookie });
  const read = (member: typeof manager, path: string) =>
    new Request(`${f.origin}${path}`, { headers: { cookie: member.cookie } });
  const sql = new SQL(testDatabaseUrl);
  let channelId: string | undefined;
  try {
    const created = await f.routes.messaging.createGroupByUsername(
      post(manager, {
        version: 1,
        requestId: createId(),
        title: 'Staging private title',
        invitedUsernames: [peer.username],
      }),
    );
    expect(created.status).toBe(200);
    channelId = (await created.json()).channelId;
    if (!channelId) throw new Error('Channel required');
    const history = (member: typeof manager) =>
      f.routes.messaging.history(
        read(member, `/api/messaging/channels/${channelId}/messages?limit=20`),
        channelId!,
      );
    const entry = (member: typeof manager) =>
      f.routes.messaging.channelEntry(
        read(member, `/api/messaging/channels/${channelId}`),
        channelId!,
      );
    expect((await history(peer)).status).toBe(404);
    expect((await entry(peer)).status).toBe(404);
    expect((await history(outsider)).status).toBe(404);
    const invitation = await f.routes.messaging.groupInvitation(
      read(peer, `/api/messaging/groups/${channelId}/invitation`),
      channelId,
    );
    expect(await invitation.json()).toEqual({
      version: 1,
      channelId,
      generation: 1,
      state: 'pending',
    });
    const accept = await f.routes.messaging.decideGroupInvitation(
      post(peer, {
        version: 1,
        channelId,
        requestId: createId(),
        expectedGeneration: 1,
        decision: 'accept',
      }),
    );
    expect(accept.status).toBe(200);
    expect((await history(peer)).status).toBe(200);
    const block = await f.routes.contacts.block(
      post(peer, {
        version: 1,
        requestId: createId(),
        otherActorId: outsider.actorId,
        blocked: true,
      }),
    );
    expect(block.status).toBe(200);
    const invite = () =>
      f.routes.messaging.inviteGroup(
        post(manager, {
          version: 1,
          channelId,
          requestId: createId(),
          invitedUsernames: [outsider.username],
        }),
      );
    expect((await invite()).status).toBe(403);
    const [pending] =
      await sql`select count(*)::int as count from messaging_group_invitations where channel_id=${channelId} and invitee_actor_id=${outsider.actorId}`;
    expect(pending.count).toBe(0);
    expect(
      (
        await f.routes.messaging.groupInvitation(
          read(outsider, `/api/messaging/groups/${channelId}/invitation`),
          channelId,
        )
      ).status,
    ).toBe(404);
    const removed = await f.routes.messaging.manageGroup(
      post(manager, {
        version: 1,
        channelId,
        requestId: createId(),
        operation: 'remove',
        memberUsername: peer.username,
      }),
    );
    expect(removed.status).toBe(200);
    expect((await history(peer)).status).toBe(404);
    expect((await entry(peer)).status).toBe(404);
    expect((await history(manager)).status).toBe(200);
  } finally {
    if (channelId) {
      await sql`delete from messaging_channels where id=${channelId}`;
      await sql`delete from outbox where payload->>'channelId'=${channelId}`;
    }
    const actors = sql.array(
      members.map((member) => member.actorId),
      'text',
    );
    await sql`delete from contact_commands where actor_id=any(${actors}::text[])`;
    await sql`delete from messaging_social_commands where actor_id=any(${actors}::text[])`;
    await sql`delete from contact_pairs where low_actor_id=any(${actors}::text[]) or high_actor_id=any(${actors}::text[])`;
    await sql.close();
  }
});

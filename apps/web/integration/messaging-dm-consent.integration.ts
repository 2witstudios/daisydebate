import { requireTestServices } from '@daisy/config';
import { betaDmPolicy } from '@daisy/auth/social-policy';
import { socialMemberReading } from '@daisy/auth/social-reading';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { openMessagingParticipants } from './messaging-fixture.test-support';
import { composeMessagingDmStore } from '../src/features/messaging/dm-composition';
import { decideMessagingDm } from '../src/features/messaging/decide-request';
import { requestMessagingDm } from '../src/features/messaging/request';
import { messagingCreationFence } from '../src/features/messaging/creation-authorization';
import { messagingAuthorizationFence } from '../src/features/messaging/authorization-fence';
import { sendMessagingMessage } from '../src/features/messaging/send';
import { dec251ContactsPolicy } from '../src/features/contacts/request-policy';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 10 };
// The production DM policy (decision 90, ADR 0160): revision 2, honouring 1.
const reading = socialMemberReading(betaDmPolicy);
// Birth months that make each band on the fixture's day (2026-10-09).
const birth = { '13-15': '2012-06', '16-17': '2010-06', adult: '2000-01' };

type Opened = Awaited<ReturnType<typeof openMessagingParticipants>>;
type Principal = Opened['sender'];

/** Real request, decision and send paths over the fixture's two members. */
function paths(opened: Opened) {
  const { client, database, fixture } = opened;
  const clock = { now: () => fixture.now };
  const age = (principal: Principal, band: keyof typeof birth) =>
    client.unsafe('update account_age set birth_month=$2 where user_id=$1', [
      principal.userId,
      birth[band],
    ]);
  const befriend = () =>
    client.unsafe(
      "insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at,accepted_at) values($1,$2,$1,'accepted',$3,$3)",
      [fixture.low, fixture.high, fixture.now],
    );
  const unfriend = () =>
    client.unsafe(
      'delete from friendships where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
  const setting = (principal: Principal, value: string) =>
    client.unsafe(
      'insert into messaging_request_settings(user_id,setting) values($1,$2) on conflict (user_id) do update set setting=excluded.setting',
      [principal.userId, value],
    );
  const request = (from: Principal, to: Principal) =>
    requestMessagingDm(
      {
        version: 1,
        requestId: createId(),
        recipientActorId: to.actorId,
        introduction: 'Hello there',
      },
      from,
      {
        policyRevision: betaDmPolicy.revision,
        clock,
        ids: { next: () => fixture.channelId },
        bounds,
        limits: dec251ContactsPolicy.requests,
        limit: async () => {},
        store: database.messagingSocialStore(
          messagingCreationFence({
            principal: from,
            clock,
            operation: { kind: 'dm', policy: betaDmPolicy },
          }),
        ),
      },
    );
  const decide = (by: Principal, decision: 'accept' | 'decline') =>
    decideMessagingDm(
      {
        version: 1,
        channelId: fixture.channelId,
        requestId: createId(),
        decision,
      },
      by,
      {
        store: composeMessagingDmStore({
          database,
          principal: by,
          clock,
          postingPolicy: betaDmPolicy,
          readingPolicy: reading,
        }),
        bounds,
        clock,
        limit: async () => {},
        limits: dec251ContactsPolicy.requests,
      },
    );
  const send = (from: Principal) =>
    sendMessagingMessage(
      {
        version: 1,
        channelId: fixture.channelId,
        requestId: createId(),
        text: 'A message',
      },
      from,
      {
        bounds: { messageUnits: 100, pageItems: 20 },
        clock,
        ids: { next: createId },
        limit: async () => {},
        store: database.messagingChannelStore(
          messagingAuthorizationFence({
            principal: from,
            clock,
            capability: 'channel.post',
            postingPolicy: betaDmPolicy,
            readingPolicy: reading,
          }),
        ),
      },
    );
  /** Removes the seeded DM, so a request opens a new revision-2 channel. */
  const fresh = () =>
    client.unsafe('delete from messaging_channels where id=$1', [
      fixture.channelId,
    ]);
  const pair = async () => {
    const [row] = await client.unsafe(
      `select c.policy_revision::int as revision, p.request_state as state,
        (select count(*)::int from notifications n where n.dm_channel_id=c.id and n.kind='dm_request') as notices
       from messaging_channels c join messaging_dm_pairs p on p.channel_id=c.id where c.id=$1`,
      [fixture.channelId],
    );
    return row;
  };
  const cleanup = async () => {
    await client.unsafe(
      'delete from messaging_request_settings where user_id in ($1,$2)',
      [fixture.userId, fixture.otherUserId],
    );
    await unfriend();
    await client.unsafe('delete from notifications where user_id in ($1,$2)', [
      fixture.userId,
      fixture.otherUserId,
    ]);
    await fixture.cleanup();
    await database.close();
    await client.close();
  };
  return {
    age,
    befriend,
    unfriend,
    setting,
    request,
    decide,
    send,
    fresh,
    pair,
    cleanup,
  };
}

test('a 14-year-old and a 16-year-old DM through a message request', async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { sender, recipient } = opened;
  const p = paths(opened);
  try {
    await p.age(sender, '13-15');
    await p.age(recipient, '16-17');
    await p.fresh();
    const requested = await p.request(sender, recipient);
    const asked = await p.pair();
    await p.decide(recipient, 'accept');
    const sent = await p.send(sender);
    assert({
      given: 'a 14-year-old asking a 16-year-old, who accepts',
      should: 'open a revision-2 request with one dm_request notice, then post',
      actual: [requested.state, asked, typeof sent.id],
      expected: [
        'pending',
        { revision: 2, state: 'pending', notices: 1 },
        'string',
      ],
    });
  } finally {
    await p.cleanup();
  }
});

test("an adult's cold request to a minor is refused until the minor accepts a friendship", async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { sender, recipient } = opened;
  const p = paths(opened);
  try {
    await p.age(sender, 'adult');
    await p.age(recipient, '13-15');
    await p.fresh();
    await assertRejects({
      given: 'an adult with no friendship asking a 14-year-old',
      should: 'refuse it as an unknown member, saying nothing of an age',
      actual: () => p.request(sender, recipient),
      code: 'NOT_FOUND',
    });
    await p.befriend();
    const requested = await p.request(sender, recipient);
    await p.decide(recipient, 'accept');
    const sent = await p.send(sender);
    await p.unfriend();
    await assertRejects({
      given: 'the same DM once the minor has unfriended the adult',
      should: "end the adult's posting",
      actual: () => p.send(sender),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the adult asking again after the minor accepted the friendship',
      should: 'open the request, and post once it is accepted',
      actual: [requested.state, typeof sent.id],
      expected: ['pending', 'string'],
    });
  } finally {
    await p.cleanup();
  }
});

test('a minor may ask an adult, and keeps the DM without a friendship', async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { sender, recipient } = opened;
  const p = paths(opened);
  try {
    await p.age(sender, '16-17');
    await p.age(recipient, 'adult');
    await p.fresh();
    await p.request(sender, recipient);
    await p.decide(recipient, 'accept');
    const [fromMinor, fromAdult] = [
      await p.send(sender),
      await p.send(recipient),
    ];
    assert({
      given: 'a 16-year-old asking an adult, who accepts',
      should: 'let both post with no friendship',
      actual: [typeof fromMinor.id, typeof fromAdult.id],
      expected: ['string', 'string'],
    });
  } finally {
    await p.cleanup();
  }
});

test('the request setting gates new requests only, and declining is never gated', async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { sender, recipient } = opened;
  const p = paths(opened);
  try {
    await p.fresh();
    await p.setting(recipient, 'none');
    await assertRejects({
      given: 'an adult who takes requests from no one',
      should: 'refuse a new request from another adult',
      actual: () => p.request(sender, recipient),
      code: 'NOT_FOUND',
    });
    await p.setting(recipient, 'friends');
    await p.befriend();
    await p.request(sender, recipient);
    // A minor now, with no friendship: accepting is closed, declining is not.
    await p.unfriend();
    await p.age(sender, 'adult');
    await p.age(recipient, '13-15');
    await assertRejects({
      given: "a pending adult request the minor's friendship no longer backs",
      should: 'refuse accepting it',
      actual: () => p.decide(recipient, 'accept'),
      code: 'AUTHORIZATION',
    });
    const declined = await p.decide(recipient, 'decline');
    assert({
      given: 'the same request',
      should: 'still let the minor decline it',
      actual: declined.state,
      expected: 'declined',
    });
  } finally {
    await p.cleanup();
  }
});

test('a revision-1 DM stays readable and postable under revision 2', async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { sender, recipient } = opened;
  const p = paths(opened);
  try {
    // The fixture seeds an accepted revision-1 DM between two adults.
    const before = await p.pair();
    const sent = [await p.send(sender), await p.send(recipient)];
    await p.setting(recipient, 'none');
    const after = await p.send(sender);
    assert({
      given: 'an accepted revision-1 DM, then the recipient choosing No one',
      should: 'keep posting on it: the setting gates new requests only',
      actual: [before, sent.map((row) => typeof row.id), typeof after.id],
      expected: [
        { revision: 1, state: 'accepted', notices: 0 },
        ['string', 'string'],
        'string',
      ],
    });
  } finally {
    await p.cleanup();
  }
});

test("a minor's own club staff may ask them directly", async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { client, sender, recipient } = opened;
  const p = paths(opened);
  const school = createId();
  try {
    await p.age(sender, 'adult');
    await p.age(recipient, '13-15');
    await p.fresh();
    await client.unsafe(
      "insert into organizations(id,kind,name,handle,owner_user_id) values($1,'school','Club',$2,$3)",
      [school, `club-${school.slice(0, 8)}`, sender.userId],
    );
    await client.unsafe(
      "insert into memberships(organization_id,user_id,status,joined_at) values($1,$2,'active',now() - interval '1 day')",
      [school, recipient.userId],
    );
    const requested = await p.request(sender, recipient);
    await p.decide(recipient, 'accept');
    const sent = await p.send(sender);
    assert({
      given: "the owner of the minor's open school, with no friendship",
      should: 'request a DM directly and post once it is accepted',
      actual: [requested.state, typeof sent.id],
      expected: ['pending', 'string'],
    });
  } finally {
    await client.unsafe('delete from memberships where organization_id=$1', [
      school,
    ]);
    await client.unsafe('delete from organizations where id=$1', [school]);
    await p.cleanup();
  }
});

test("a member's request setting is in their export and goes with their erasure", async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { client, fixture, sender } = opened;
  const p = paths(opened);
  try {
    await p.setting(sender, 'friends');
    const exported = await fixture.exportSubject(fixture.actorId);
    await fixture.eraseSubject(fixture.actorId);
    const [left] = await client.unsafe(
      'select count(*)::int as rows from messaging_request_settings where user_id=$1',
      [sender.userId],
    );
    assert({
      given: 'a member who chose Friends only, exported and then erased',
      should: 'export the choice, and leave no row after erasure',
      actual: [
        exported.messaging_request_settings?.map((row) => row.setting),
        left.rows,
      ],
      expected: [['friends'], 0],
    });
  } finally {
    await p.cleanup();
  }
});

test('a message request notice stands while it is pending, and never across a block', async () => {
  const opened = await openMessagingParticipants(databaseUrl);
  const { client, database, fixture, sender, recipient } = opened;
  const p = paths(opened);
  const inbox = async () =>
    (
      await database.readNotifications({
        userId: recipient.userId,
        unreadOnly: false,
        limit: 10,
        now: fixture.now,
        after: null,
      })
    ).rows.flatMap((row) =>
      row.kind === 'dm_request' ? [[row.channelId, row.from !== null]] : [],
    );
  try {
    await p.fresh();
    await p.request(sender, recipient);
    const pending = await inbox();
    await client.unsafe(
      'update contact_pairs set low_blocks_high=true where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
    const blocked = await inbox();
    assert({
      given: 'a pending request, then a block between the pair',
      should: 'show the recipient the notice, then stop showing it',
      actual: [pending, blocked],
      expected: [[[fixture.channelId, true]], []],
    });
  } finally {
    await p.cleanup();
  }
});

import { dec251MessagingValues } from '../src/features/messaging/beta-policy';
import type { SQL } from 'bun';
import { admitParticipants } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  blockDependencies,
  type openMessagingFixture,
} from './messaging-fixture.test-support';
import { changeFriendship } from '../src/features/messaging/friends/operations';
import { blockMessagingContact } from '../src/features/messaging/block';
import { messagingSocialAuthorizationFence } from '../src/features/messaging/social-authorization';

export type Opened = Awaited<ReturnType<typeof openMessagingFixture>>;

/** The real operation, fence and store, as the friend routes compose them. */
export const friendChange =
  ({ database, fixture }: Opened) =>
  (
    principal: AuthorizationPrincipal,
    command: Parameters<typeof changeFriendship>[1],
    username: string,
  ) => {
    const clock = { now: () => fixture.now };
    return changeFriendship(principal, command, username, {
      clock,
      ids: { next: createId },
      limits: dec251MessagingValues.socialRequests,
      limit: async () => {},
      lookup: (name) => database.lookupHumanActorByUsername(name),
      store: (capability) =>
        database.messagingSocialStore(
          messagingSocialAuthorizationFence({
            principal,
            clock,
            operation: { kind: 'friend', capability },
          }),
        ),
    });
  };

/** The real block operation through the same store. */
export const blockContact = (
  opened: Opened,
  principal: AuthorizationPrincipal,
  otherActorId: string,
) =>
  blockMessagingContact(
    { version: 1, requestId: createId(), otherActorId, blocked: true },
    principal,
    blockDependencies(opened, principal),
  );

/** What a refused change answers: its error code, or the relation it made. */
export const settle = async (
  change: Promise<{ readonly relation: string }>,
) => {
  try {
    return (await change).relation;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
};

/** Backends waiting, directly or behind another waiter, on the gate's lock. */
const queuedBehind = async (client: SQL, gate: number) => {
  const rows = (await client.unsafe(
    "select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity where wait_event_type = 'Lock'",
  )) as { pid: number; blockers: number[] }[];
  const queued = new Set<number>();
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows)
      if (
        !queued.has(row.pid) &&
        row.blockers.some((pid) => pid === gate || queued.has(pid))
      ) {
        queued.add(row.pid);
        grew = true;
      }
  }
  return queued.size;
};

const GATE_POLLS = 500;

/**
 * Holds a user's account lock on a third connection until `count` changes
 * queue behind it, then lets them go. Each change has then started before
 * any of them read, so the race always overlaps; a change that never takes
 * the lock never queues, and the gate throws rather than pass by luck.
 */
export async function raceBehindAccountLock<T extends readonly unknown[]>(
  client: SQL,
  userId: string,
  changes: { readonly [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (held = resolve));
  const gate = client.begin(async (tx) => {
    const [row] = (await tx.unsafe('select pg_backend_pid() as pid')) as {
      pid: number;
    }[];
    await tx.unsafe('select id from users where id = $1 for update', [userId]);
    held(row!.pid);
    await released;
  });
  const pid = await holding;
  const racing = (changes as readonly (() => Promise<unknown>)[]).map(
    (change) => change(),
  );
  const settled: unknown[] = [];
  for (const change of racing)
    change.then(
      (value) => settled.push(value),
      (error: unknown) => settled.push(error),
    );
  try {
    for (
      let poll = 0;
      (await queuedBehind(client, pid)) < changes.length;
      poll++
    ) {
      // A change that ends before the gate opens never took the lock.
      if (settled.length > 0)
        throw new Error('a racing change ended before the account lock', {
          cause: settled[0],
        });
      if (poll === GATE_POLLS)
        throw new Error('the racing changes never queued on the account lock');
      await Bun.sleep(10);
    }
  } catch (error) {
    release();
    await gate;
    await Promise.allSettled(racing);
    throw error;
  }
  release();
  await gate;
  return (await Promise.all(racing)) as unknown as T;
}

/** A text[] literal; Bun binds a JS array as one joined string. Seeded ids are cuid2, so need no quoting. */
const textArray = (values: readonly string[]) => `{${values.join(',')}}`;

type Member = { readonly userId: string; readonly actorId: string };

/** Members who may be named; `adult` ones also carry an account age, as the fixture's members do. */
export async function seedMembers(
  client: SQL,
  count: number,
  { now }: { readonly now: string },
): Promise<Member[]> {
  const members = Array.from({ length: count }, () => ({
    userId: createId(),
    actorId: createId(),
  }));
  const userIds = members.map((member) => member.userId);
  await client.unsafe(
    'insert into users(id,username,email_verified) select id,id,true from unnest($1::text[]) as id',
    [textArray(userIds)],
  );
  await client.unsafe(
    "insert into actors(id,kind,user_id) select a,'human',u from unnest($1::text[],$2::text[]) as t(a,u)",
    [textArray(members.map((member) => member.actorId)), textArray(userIds)],
  );
  // Admitted participants (ADR 0075), their age recorded at the suite's clock.
  await admitParticipants(client, userIds, now);
  return members;
}

/** Friendships between `actorId` and each member, as `requesterActorId` asked. */
export async function seedFriendships(
  client: SQL,
  actorId: string,
  members: readonly Member[],
  {
    state,
    requesterActorId,
    now,
  }: {
    readonly state: 'pending' | 'accepted';
    readonly requesterActorId: (member: Member) => string;
    readonly now: string;
  },
) {
  const pairs = members.map((member) => [actorId, member.actorId].sort());
  const lows = pairs.map(([low]) => low!);
  const highs = pairs.map(([, high]) => high!);
  await client.unsafe(
    'insert into messaging_contact_pairs(low_actor_id,high_actor_id) select * from unnest($1::text[],$2::text[])',
    [textArray(lows), textArray(highs)],
  );
  await client.unsafe(
    "insert into messaging_friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at,accepted_at) select l,h,r,$4::text,$5::timestamptz,case when $4::text = 'accepted' then $5::timestamptz end from unnest($1::text[],$2::text[],$3::text[]) as t(l,h,r)",
    [
      textArray(lows),
      textArray(highs),
      textArray(members.map(requesterActorId)),
      state,
      now,
    ],
  );
}

/** Removes seeded members; their pairs cascade their friendships. */
export async function removeMembers(client: SQL, members: readonly Member[]) {
  const actorIds = members.map((member) => member.actorId);
  const userIds = members.map((member) => member.userId);
  await client.unsafe(
    'delete from messaging_contact_pairs where low_actor_id = any($1::text[]) or high_actor_id = any($1::text[])',
    [textArray(actorIds)],
  );
  // Friend requests leave DEC-251 ledger rows naming both members.
  await client.unsafe(
    'delete from messaging_social_commands where actor_id = any($1::text[]) or counterpart_actor_id = any($1::text[])',
    [textArray(actorIds)],
  );
  await client.unsafe('delete from actors where id = any($1::text[])', [
    textArray(actorIds),
  ]);
  await client.unsafe(
    'delete from account_age where user_id = any($1::text[])',
    [textArray(userIds)],
  );
  await client.unsafe('delete from users where id = any($1::text[])', [
    textArray(userIds),
  ]);
}

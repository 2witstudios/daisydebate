import { expect, test } from 'bun:test';
import type { SavepointSQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import {
  createGuardianStore,
  friendsPrivacyAdopter,
  holdForGuardian,
  listFriendships,
  notificationInboxOperations,
  scopeTransaction,
  withRolledBackDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import type { GuardianCommand } from '@daisy/protocol/guardians';
import { dec251ContactsPolicy } from '../src/features/contacts/request-policy';
import { runGuardianCommand } from '../src/features/parental-controls/commands';
import { createBots } from './tab-tournament.test-support';

const { databaseUrl } = requireTestServices(process.env);

test('two guardians share one choice and only current guardians can clear a hold', async () => {
  const at = new Date();
  const birth = `${at.getUTCFullYear() - 15}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [parent, child, coGuardian, stranger, sibling] = await createBots(
        sql,
        ['Parent', 'Child', 'Co-guardian', 'Stranger', 'Sibling'],
      );
      if (!parent || !child || !coGuardian || !stranger || !sibling)
        throw new Error('Missing family fixture');
      for (const person of [parent, child, coGuardian, stranger, sibling])
        await sql`update users set email=${`${person.userId}@example.test`} where id=${person.userId}`;
      await sql`update account_age set birth_month=${birth}, version=version+1
        where user_id in (${child.userId},${sibling.userId})`;
      return { parent, child, coGuardian, stranger, sibling };
    },
    work: async (db, { parent, child, coGuardian, stranger, sibling }, sql) => {
      const store = createGuardianStore(db);
      const run = (caller: typeof parent, command: GuardianCommand) =>
        store.forSubject(caller.userId, (session) =>
          runGuardianCommand(
            {
              session,
              caller,
              at: at.toISOString(),
              requestLimits: dec251ContactsPolicy.requests,
            },
            command,
          ),
        );
      const linkIdFor = async (guardian: typeof parent, ward = child) => {
        expect(
          await run(guardian, {
            version: 1,
            type: 'request-link',
            username: `bot-${ward.userId}`,
            noticeVersion: 'draft-1',
          }),
        ).toMatchObject({ kind: 'accepted' });
        const row = await store.forSubject(guardian.userId, (session) =>
          session.openLink(ward.userId),
        );
        if (!row) throw new Error('Link missing');
        return row.id;
      };
      const confirm = (linkId: string, ward = child) =>
        run(ward, {
          version: 1,
          type: 'confirm-parent',
          linkId,
          noticeVersion: 'draft-1',
        });
      const read = () =>
        store.forSubject(child.userId, (session) =>
          session.protectionLevel(child.userId),
        );
      const direct = async (userId: string) => {
        return sql.savepoint(async (scoped) => {
          await scoped`select set_config('daisy.subject_scope', ${userId}, true)`;
          return scoped`select choice from protection_levels where user_id=${child.userId}`;
        });
      };
      const first = await linkIdFor(parent);
      const second = await linkIdFor(coGuardian);
      const supervised = {
        version: 1,
        type: 'set-protection-level',
        linkId: first,
        choice: { level: 'supervised' },
      } as const;
      expect(await read()).toEqual({ level: 'independent' });
      expect(await run(parent, supervised)).toEqual({
        kind: 'refused',
        refusal: 'not-active',
      });
      expect(await run(stranger, supervised)).toEqual({
        kind: 'refused',
        refusal: 'not-found',
      });
      expect(await confirm(first)).toEqual({ kind: 'accepted' });
      expect(await confirm(second)).toEqual({ kind: 'accepted' });
      expect(await read()).toEqual({ level: 'guided' });
      expect(await run(parent, supervised)).toEqual({ kind: 'accepted' });
      expect(await direct(child.userId)).toEqual([
        { choice: { level: 'supervised' } },
      ]);
      expect(await direct(stranger.userId)).toEqual([]);
      await expect(
        sql.savepoint(async (scoped) => {
          await scoped`select set_config('daisy.subject_scope', ${child.userId}, true)`;
          return scoped`update protection_levels set choice='{"level":"independent"}' where user_id=${child.userId}`;
        }),
      ).rejects.toThrow(/permission denied for table protection_levels/);
      const custom = {
        level: 'custom',
        friendApproval: 'all',
        friendsOnlyMessages: false,
        rankedAllowed: true,
      } as const;
      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: custom,
        }),
      ).toEqual({ kind: 'accepted' });
      expect(await direct(child.userId)).toEqual([{ choice: custom }]);
      const pairOf = (a: typeof child, b: typeof child) => {
        const [lowActorId, highActorId] = [a.actorId, b.actorId].sort();
        if (!lowActorId || !highActorId)
          throw new Error('Pair fixture incomplete');
        return { lowActorId, highActorId };
      };
      const adultPair = pairOf(child, stranger);
      const seedFriendRequest = async (
        pair: ReturnType<typeof pairOf>,
        requester: typeof child,
      ) => {
        const { lowActorId, highActorId } = pair;
        await sql`insert into contact_pairs(low_actor_id,high_actor_id)
          values(${lowActorId},${highActorId}) on conflict do nothing`;
        await sql`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at)
          values(${lowActorId},${highActorId},${requester.actorId},'waiting-for-guardian',${at})`;
      };
      const held = (
        caller: typeof child,
        ward: typeof child,
        pair: ReturnType<typeof pairOf>,
        at: string,
      ) =>
        db.transaction(async (tx) => {
          const id = createId();
          const ids = [id];
          await scopeTransaction(tx, { subjectUserId: caller.userId });
          await holdForGuardian(tx, {
            pair,
            childActorId: ward.actorId,
            at,
            nextId: () => ids.shift() ?? createId(),
          });
          return id;
        });
      const listRequests = (subject: typeof child) =>
        listFriendships(db, subject, async () => {});
      const inbox = (user: typeof parent) =>
        db.transaction((tx) =>
          notificationInboxOperations({
            database: {
              execute: tx.execute.bind(tx),
              transaction: db.transaction,
            },
          }).readNotifications({
            userId: user.userId,
            limit: 10,
            unreadOnly: false,
            now: at.toISOString(),
            after: null,
          }),
        );
      const exportFriends = (subject: typeof child) =>
        db.transaction((tx) => friendsPrivacyAdopter.export(tx, subject));
      const { lowActorId: low, highActorId: high } = adultPair;
      const stamp = at.toISOString();
      await seedFriendRequest(adultPair, stranger);
      const approvalId = await held(stranger, child, adultPair, stamp);
      const readApprovals = (guardian: typeof parent) =>
        store.forSubject(guardian.userId, (session) =>
          session.waitingFriendApprovals(),
        );
      const approve = {
        version: 1,
        type: 'answer-friend-approval',
        approvalId,
        decision: 'approve',
      } as const;
      expect(await readApprovals(parent)).toEqual([
        {
          id: approvalId,
          child: `bot-${child.userId}`,
          counterpart: `bot-${stranger.userId}`,
          direction: 'incoming',
        },
      ]);
      expect(await readApprovals(stranger)).toEqual([]);
      expect(await run(stranger, approve)).toEqual({
        kind: 'refused',
        refusal: 'not-waiting',
      });
      expect((await listRequests(child))[0]?.waiting).toBe(
        'waiting-for-guardian',
      );
      expect((await listRequests(stranger))[0]?.waiting).toBe('waiting');
      expect((await exportFriends(child)).friendships).toMatchObject([
        { state: 'waiting-for-guardian' },
      ]);
      expect((await exportFriends(stranger)).friendships).toMatchObject([
        { state: 'pending' },
      ]);
      expect((await inbox(parent)).rows.map((row) => row.kind)).toEqual([
        'friend_guardian_approval',
      ]);
      const initialAdultNotice = (await inbox(parent)).rows[0]!;
      const scoped = async <T>(
        subject: typeof child,
        work: (sp: SavepointSQL) => Promise<T>,
      ) =>
        sql.savepoint(async (sp) => {
          await sp`select set_config('daisy.subject_scope', ${subject.userId}, true)`;
          return work(sp);
        });
      expect<unknown>(
        await scoped(
          stranger,
          (sp) =>
            sp`select public.daisy_protection_level(${child.userId}) as choice`,
        ),
      ).toEqual([{ choice: null }]);
      expect<unknown>(
        await scoped(
          parent,
          (sp) =>
            sp`select public.daisy_protection_level(${child.userId}) as choice`,
        ),
      ).toEqual([{ choice: custom }]);
      expect<unknown>(
        await scoped(
          stranger,
          (sp) =>
            sp`select id from friend_guardian_approvals where id=${approvalId}`,
        ),
      ).toEqual([]);
      const unneededId = createId();
      await scoped(
        stranger,
        (sp) => sp`select public.daisy_hold_friend_request(
        ${unneededId}, ${low}, ${high}, ${stranger.actorId}, ${stamp}::timestamptz)`,
      );
      expect<unknown>(
        await scoped(
          stranger,
          (sp) =>
            sp`select id from friend_guardian_approvals where id=${unneededId}`,
        ),
      ).toEqual([]);
      await sql`update notifications set read_at=${at} where id=${initialAdultNotice.id}`;
      await expect(
        sql.savepoint(
          (sp) =>
            sp`select * from public.daisy_protection_guardians(${child.userId})`,
        ),
      ).rejects.toThrow(
        /permission denied for function daisy_protection_guardians/,
      );
      await expect(
        sql.savepoint(
          (sp) =>
            sp`update friend_guardian_approvals set cleared=true where id=${approvalId}`,
        ),
      ).rejects.toThrow(
        /permission denied for table friend_guardian_approvals/,
      );

      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: { level: 'independent' },
        }),
      ).toEqual({ kind: 'accepted' });
      expect(await readApprovals(parent)).toEqual([]);
      expect((await listRequests(child))[0]?.waiting).toBeUndefined();
      expect((await listRequests(stranger))[0]?.waiting).toBeUndefined();
      expect((await inbox(parent)).rows).toEqual([]);
      expect(await run(parent, { ...approve, decision: 'decline' })).toEqual({
        kind: 'refused',
        refusal: 'not-waiting',
      });
      expect<unknown>(
        await scoped(
          parent,
          (sp) =>
            sp`select public.daisy_clear_friend_guardian_hold(${approvalId}) as changed`,
        ),
      ).toEqual([{ changed: false }]);
      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: custom,
        }),
      ).toEqual({ kind: 'accepted' });
      expect((await inbox(parent)).rows).toMatchObject([
        { id: initialAdultNotice.id, readAt: null },
      ]);
      await sql`update notifications set read_at=${at} where id=${initialAdultNotice.id}`;
      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: custom,
        }),
      ).toEqual({ kind: 'accepted' });
      expect((await inbox(parent)).rows).toMatchObject([
        { id: initialAdultNotice.id, readAt: stamp },
      ]);

      const end = { version: 1, type: 'end-link', linkId: first } as const;
      expect(await run(parent, end)).toEqual({ kind: 'accepted' });
      expect(await readApprovals(parent)).toEqual([]);
      expect(await run(parent, approve)).toEqual({
        kind: 'refused',
        refusal: 'not-waiting',
      });
      const unrelated = await sql.savepoint(async (sp) => {
        await sp`select set_config('daisy.subject_scope', ${parent.userId}, true)`;
        const raw =
          await sp`select id from friend_guardian_approvals where id=${approvalId}`;
        const result =
          await sp`select public.daisy_clear_friend_guardian_hold(${approvalId}) as changed`;
        return { raw, result };
      });
      expect<unknown>(unrelated).toEqual({
        raw: [],
        result: [{ changed: false }],
      });
      expect(await run(coGuardian, approve)).toEqual({ kind: 'accepted' });
      expect(await readApprovals(coGuardian)).toEqual([]);
      expect<unknown>(
        await sql`select state from friendships where low_actor_id=${low} and high_actor_id=${high}`,
      ).toEqual([{ state: 'pending' }]);
      expect<unknown>(
        await sql`select kind from notifications where user_id=${child.userId}`,
      ).toEqual([{ kind: 'friend_request_received' }]);
      const erasePending = () =>
        sql`delete from friendships where low_actor_id=${low} and high_actor_id=${high}`;
      for (const requester of [child, stranger]) {
        await erasePending();
        await seedFriendRequest(adultPair, requester);
        const id = await held(requester, child, adultPair, stamp);
        expect(
          await run(coGuardian, {
            ...approve,
            approvalId: id,
            decision: 'decline',
          }),
        ).toEqual({ kind: 'accepted' });
        const ledger =
          await sql`select decliner_actor_id, requester_actor_id, declined_count::int as declined_count
          from social_request_declines
          where ${child.actorId} in (decliner_actor_id, requester_actor_id)`;
        expect<unknown>(ledger).toEqual(
          requester === child
            ? []
            : [
                {
                  decliner_actor_id: child.actorId,
                  requester_actor_id: stranger.actorId,
                  declined_count: 1,
                },
              ],
        );
      }

      const siblingLink = await linkIdFor(coGuardian, sibling);
      expect(await confirm(siblingLink, sibling)).toEqual({ kind: 'accepted' });
      const childPair = pairOf(child, sibling);
      await seedFriendRequest(childPair, child);
      const firstHold = await held(child, child, childPair, stamp);
      const before = await inbox(coGuardian);
      const initialNotice = before.rows.find(
        (row) => row.kind === 'friend_guardian_approval',
      );
      if (!initialNotice)
        throw new Error('The first child’s notification did not stand');
      await sql`update notifications set read_at=${at} where id=${initialNotice.id}`;
      expect(
        await run(coGuardian, { ...supervised, linkId: siblingLink }),
      ).toEqual({ kind: 'accepted' });
      const resurfaceAt = new Date(at.getTime() + 1000).toISOString();
      const secondHold = await held(sibling, sibling, childPair, resurfaceAt);
      const surfaced = (await inbox(coGuardian)).rows.find(
        (row) => row.kind === 'friend_guardian_approval',
      );
      expect(surfaced).toMatchObject({
        id: initialNotice.id,
        readAt: null,
        surfacedAt: resurfaceAt,
      });
      await held(
        sibling,
        sibling,
        childPair,
        new Date(at.getTime() + 2000).toISOString(),
      );
      expect(
        (await inbox(coGuardian)).rows.find(
          (row) => row.id === initialNotice.id,
        )?.surfacedAt,
      ).toBe(resurfaceAt);

      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: { level: 'independent' },
        }),
      ).toEqual({ kind: 'accepted' });
      expect((await readApprovals(coGuardian)).map(({ id }) => id)).toEqual([
        secondHold,
      ]);
      expect((await listRequests(child))[0]?.waiting).toBe('waiting');
      expect((await listRequests(sibling))[0]?.waiting).toBe(
        'waiting-for-guardian',
      );
      expect(
        await run(coGuardian, {
          ...approve,
          approvalId: firstHold,
          decision: 'decline',
        }),
      ).toEqual({ kind: 'refused', refusal: 'not-waiting' });
      expect(
        await run(coGuardian, { ...approve, approvalId: secondHold }),
      ).toEqual({ kind: 'accepted' });
      expect(
        (await inbox(coGuardian)).rows.filter(
          (row) => row.kind === 'friend_guardian_approval',
        ),
      ).toEqual([]);
      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: custom,
        }),
      ).toEqual({ kind: 'accepted' });
      expect(await read()).toEqual(custom);
      expect(await run(coGuardian, { ...end, linkId: second })).toMatchObject({
        kind: 'accepted',
      });
      expect(await read()).toEqual({ level: 'independent' });
      expect(await direct(child.userId)).toEqual([]);
    },
  });
});

import { requireTestServices } from '@daisy/config';
import {
  ageStepOperations,
  createGuardianStore,
  withRolledBackDatabase,
} from '@daisy/db/testing';
import type { GuardianCommand } from '@daisy/protocol/guardians';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  runGuardianCommand,
  submitGuardianCommand,
} from '../src/features/parental-controls/commands';
import { createBots } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const at = new Date();
const stamp = at.toISOString();
const birth = (age: number) =>
  `${at.getUTCFullYear() - age}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

test('guardian links use the web role, a child decision, and immutable consent', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [parent, child, other, cancelled] = await createBots(sql, [
        'Parent',
        'Child',
        'Other child',
        'Cancel child',
      ]);
      if (!parent || !child || !other || !cancelled)
        throw new Error('Missing family fixture');
      for (const person of [parent, child, other, cancelled])
        await sql`update users set email=${`${person.userId}@example.test`} where id=${person.userId}`;
      for (const person of [child, other, cancelled])
        await sql`update account_age set birth_month=${birth(15)}, version=version+1 where user_id=${person.userId}`;
      return { parent, child, other, cancelled };
    },
    work: async (db, { parent, child, other, cancelled }, sql) => {
      const store = createGuardianStore(db);
      const run = (caller: typeof parent, command: GuardianCommand) =>
        store.forSubject(caller.userId, (session) =>
          runGuardianCommand({ session, caller, at: stamp }, command),
        );
      const request = async (target: typeof child) => {
        const result = await run(parent, {
          version: 1,
          type: 'request-link',
          username: `bot-${target.userId}`,
          noticeVersion: 'draft-1',
        });
        if (result.kind !== 'accepted')
          throw new Error(`Request refused: ${result.refusal}`);
        const link = await store.forSubject(parent.userId, (session) =>
          session.openLink(target.userId),
        );
        if (!link) throw new Error('Link was missing');
        return link;
      };

      const waiting = await request(child);
      const visible = () =>
        sql`select user_id from public.daisy_linked_adult_users(${child.userId}) where user_id=${parent.userId}`;
      const before = await visible();
      const confirm = {
        version: 1,
        type: 'confirm-parent',
        linkId: waiting.id,
        noticeVersion: 'draft-1',
      } as const;
      const intruder = await run(parent, confirm);
      const confirmed = await run(child, confirm);
      const after = await visible();
      const rejected = await request(other);
      await run(other, {
        version: 1,
        type: 'refuse-parent',
        linkId: rejected.id,
      });
      const withdrawing = await request(cancelled);
      await run(parent, {
        version: 1,
        type: 'cancel-request',
        request: { kind: 'link', id: withdrawing.id },
      });
      const [report] = await sql`select reason, surface from reports
        where reporter_actor_id=${other.actorId} and subject_actor_id=${parent.actorId}`;

      const guard = async (mutation: 'update' | 'delete', owner = false) => {
        try {
          await sql.savepoint(async (sp) => {
            if (owner) await sp`reset role`;
            await sp`select set_config('daisy.subject_scope', ${parent.userId}, true)`;
            if (mutation === 'update')
              await sp`update guardian_consent_evidence set notice_version='forged'
                where id=${waiting.guardianConsentId}`;
            else
              await sp`delete from guardian_consent_evidence where id=${waiting.guardianConsentId}`;
          });
          return 'changed';
        } catch (error) {
          return (error as { errno?: string }).errno;
        }
      };
      assert({
        given:
          'a request, confirmation, refusal and cancellation under their real actors',
        should:
          'grant authority only on child confirmation, file a private guardian safety report and keep evidence unchangeable',
        actual: {
          waiting: waiting.status,
          before: before.length,
          after: after.length,
          intruder,
          confirmed: confirmed.kind,
          report,
          states: await store.forSubject(parent.userId, async (session) =>
            Promise.all(
              [waiting.id, rejected.id, withdrawing.id].map(
                async (id) => (await session.link(id))?.status,
              ),
            ),
          ),
          evidence: [
            await guard('update'),
            await guard('delete'),
            await guard('update', true),
            await guard('delete', true),
          ],
        },
        expected: {
          waiting: 'requested',
          before: 0,
          after: 1,
          intruder: { kind: 'refused', refusal: 'not-found' },
          confirmed: 'accepted',
          report: { reason: 'not-my-parent', surface: 'guardian-link' },
          states: ['active', 'refused', 'cancelled'],
          evidence: ['42501', '42501', '23514', '23514'],
        },
      });
    },
  });
});

test('a verified child claims the parent’s birth month, evidence and beta access together', async () => {
  const email = `${createId()}@example.test`;
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [parent] = await createBots(sql, ['Parent']);
      if (!parent) throw new Error('Missing parent fixture');
      await sql`update users set email=${`${parent.userId}@example.test`} where id=${parent.userId}`;
      return parent;
    },
    work: async (db, parent, sql) => {
      const store = createGuardianStore(db);
      const invite = (birthMonth: string) =>
        store.forSubject(parent.userId, (session) =>
          runGuardianCommand(
            { session, caller: parent, at: stamp },
            {
              version: 1,
              type: 'create-child-account',
              birthMonth,
              email,
              firstName: 'Sam',
              noticeVersion: 'draft-1',
            },
          ),
        );
      const young = await invite(birth(12));
      const adult = await invite(birth(18));
      const sent = await invite(birth(15));
      const userId = createId();
      await sql`insert into users(id, email, email_verified, created_at)
        values(${userId}, ${email}, true, ${new Date(at.getTime() + 1000)})`;
      const age = ageStepOperations({ database: db, eventSink: undefined });
      const now = new Date(at.getTime() + 2000).toISOString();
      const binding = await age.childAccountBinding(userId, now);
      if (!binding) throw new Error('No age binding');
      const linkId = createId();
      await age.recordAgeStep({
        userId,
        birthMonth: birth(30),
        now,
        termsVersion: 'fixture',
        parentalControls: {
          linkId,
          pendingBetaEventId: createId(),
          requestId: binding.requestId,
        },
      });
      const [account] =
        await sql`select u.name, a.birth_month, b.state, t.terms_version
        from users u join account_age a on a.user_id=u.id
        join account_terms t on t.user_id = u.id join account_beta_access b on b.user_id=u.id
        where u.id=${userId}`;
      const link = await store.forSubject(parent.userId, (session) =>
        session.link(linkId),
      );
      assert({
        given:
          'a 15-year-old’s eligible invitation, verified email, and different submitted age',
        should:
          'claim the parent’s birth month and record the terms, active link and inherited beta approval',
        actual: [
          young,
          adult,
          sent.kind,
          binding.birthMonth,
          account,
          link?.status,
          link?.activation,
        ],
        expected: [
          { kind: 'refused', refusal: 'under-13' },
          { kind: 'refused', refusal: 'not-a-minor' },
          'accepted',
          birth(15),
          {
            name: 'Sam',
            birth_month: birth(15),
            state: 'approved',
            terms_version: 'fixture',
          },
          'active',
          'created-account',
        ],
      });
    },
  });
});

test('address conflicts and stale invitations never create consent or record a cancelled birth month', async () => {
  const email = `${createId()}@example.test`;
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [first, second] = await createBots(sql, [
        'First parent',
        'Second parent',
      ]);
      if (!first || !second) throw new Error('Missing parent fixtures');
      for (const parent of [first, second])
        await sql`update users set email=${`${parent.userId}@example.test`} where id=${parent.userId}`;
      return { first, second };
    },
    work: async (db, { first, second }, sql) => {
      const store = createGuardianStore(db);
      const invite = (caller: typeof first, at: string) =>
        submitGuardianCommand(store, caller, at, {
          version: 1,
          type: 'create-child-account',
          birthMonth: birth(15),
          email,
          firstName: 'Only one request',
          noticeVersion: 'draft-1',
        });
      const original = await invite(first, stamp);
      const overlap = await invite(second, stamp);
      const orphanSignatures = await db.transaction(async () => {
        await sql`select set_config('daisy.subject_scope', ${second.userId}, true)`;
        const [row] =
          await sql`select count(*)::int as count from guardian_consent_evidence where person_user_id=${second.userId}`;
        return row?.count;
      });

      const child = createId();
      await sql`insert into users(id, email, email_verified, created_at)
        values (${child}, ${email}, true, ${new Date(at.getTime() + 1_000)})`;
      const age = ageStepOperations({ database: db, eventSink: undefined });
      const now = new Date(at.getTime() + 2_000).toISOString();
      const binding = await age.childAccountBinding(child, now);
      if (!binding) throw new Error('No live invitation');
      await submitGuardianCommand(store, first, now, {
        version: 1,
        type: 'cancel-request',
        request: { kind: 'invitation', id: binding.requestId },
      });
      const response = await age
        .recordAgeStep({
          userId: child,
          birthMonth: binding.birthMonth,
          now,
          termsVersion: 'test',
          parentalControls: {
            linkId: createId(),
            pendingBetaEventId: createId(),
            requestId: binding.requestId,
          },
        })
        .then(
          () => 'written',
          () => 'refused',
        );
      const expiredEmail = `${createId()}@example.test`;
      const expiredAt = new Date(at.getTime() - 15 * 86_400_000).toISOString();
      await submitGuardianCommand(store, first, expiredAt, {
        version: 1,
        type: 'create-child-account',
        birthMonth: birth(15),
        email: expiredEmail,
        firstName: 'Expired details',
        noticeVersion: 'draft-1',
      });
      const [expired] =
        await sql`select public.daisy_expire_child_account_requests(200, false) as count`;
      const parentRows = await store.forSubject(first.userId, (session) =>
        session.requests(),
      );
      assert({
        given:
          'two invitations for one address, cancellation after displaying the birth month, and an expired request',
        should:
          'reject the overlapping claim path without orphan evidence, reject the stale age write, and scrub expired contact data',
        actual: {
          first: original.kind === 'accepted' && original.mail?.kind,
          second: overlap.kind === 'accepted' && overlap.mail?.kind,
          orphanSignatures,
          response,
          ageRecorded: await age.hasRecordedAge(child),
          expired: expired?.count,
          contactsCleared: parentRows.every(
            (request) =>
              request.email === null &&
              request.firstName === null &&
              request.birthMonth === null,
          ),
        },
        expected: {
          first: 'sign-in',
          second: 'account-not-changed',
          orphanSignatures: 0,
          response: 'refused',
          ageRecorded: false,
          expired: 1,
          contactsCleared: true,
        },
      });
    },
  });
});

test('resend asks a now-existing child to confirm instead of reviving an open claim', async () => {
  const email = `${createId()}@example.test`;
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [parent, child] = await createBots(sql, [
        'Parent',
        'Existing child',
      ]);
      if (!parent || !child) throw new Error('Missing family fixtures');
      await sql`update users set email=${`${parent.userId}@example.test`} where id=${parent.userId}`;
      await sql`update account_age set birth_month=${birth(15)}, version=version+1 where user_id=${child.userId}`;
      return { parent, child };
    },
    work: async (db, { parent, child }, sql) => {
      const store = createGuardianStore(db);
      const send = (command: GuardianCommand) =>
        submitGuardianCommand(store, parent, stamp, command);
      await send({
        version: 1,
        type: 'create-child-account',
        email,
        birthMonth: birth(15),
        firstName: 'Child',
        noticeVersion: 'draft-1',
      });
      const [waiting] = await store.forSubject(parent.userId, (session) =>
        session.requests(),
      );
      if (!waiting) throw new Error('Missing invitation');
      await sql`update users set email=${email} where id=${child.userId}`;
      const sent = await send({
        version: 1,
        type: 'send-again',
        request: { kind: 'invitation', id: waiting.id },
      });
      const [changed] = await store.forSubject(parent.userId, (session) =>
        session.requests(),
      );
      const childLink = await store.forSubject(child.userId, (session) =>
        changed?.requestedLinkId
          ? session.link(changed.requestedLinkId)
          : Promise.resolve(null),
      );
      assert({
        given:
          'a child email invitation and a member who takes that verified address before resend',
        should:
          'send confirmation to the account and leave the link awaiting the child',
        actual: [
          sent.kind === 'accepted' && sent.mail?.kind,
          changed?.status,
          childLink?.status,
          childLink?.minorUserId,
        ],
        expected: ['confirm-link', 'linked', 'requested', child.userId],
      });
    },
  });
});

import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  newReleaseLinkToken,
  releaseLinkDigest,
} from '../src/features/media-releases/link-token';
import { withRoomRuntime } from './room-runtime.test-support';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * PYL-6 and PYL-7 (ADR 0151) against the real database and its row-level
 * security: a minor asks, a parent signs and withdraws through single-use
 * hashed links, and a club attests.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];
type Store = {
  readonly mediaReleases: {
    readonly ask: (c: {
      userId: string;
      email: string;
      recipientHash: string;
    }) => Promise<{ kind: string; requestId?: string; reason?: string }>;
    readonly sign: (
      digest: string,
      form: unknown,
    ) => Promise<{ kind: string; reason?: string }>;
    readonly withdraw: (
      digest: string,
      form: unknown,
    ) => Promise<{ kind: string; reason?: string }>;
    readonly readMinorRelease: (
      userId: string,
    ) => Promise<{ standing: { kind: string } }>;
    readonly stopRequests: (recipientHash: string) => Promise<void>;
    readonly readActivePublishReleases: (
      ids: readonly string[],
    ) => Promise<readonly unknown[]>;
  };
  readonly mediaReleaseClubs: {
    readonly confirmClubReleases: (c: {
      viewerUserId: string;
      organizationId: string;
      studentUserIds: readonly string[];
      form: unknown;
    }) => Promise<{
      kind: string;
      reason?: string;
      ineligible?: readonly string[];
    }>;
  };
  readonly prepareMediaReleaseMail: (i: {
    mailId: string;
    linkId: string;
    tokenDigest: string;
  }) => Promise<{ kind: string }>;
};

const setAge = (f: Fixture, member: Member, age: string) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${age}::interval, 'YYYY-MM'), version = version + 1,
      recorded_at = now() - interval '1 second'
    where user_id = ${member.userId}`;

/** The schools a test made go after it, children first. */
const withSchools = async (
  f: Fixture,
  run: (schools: string[]) => Promise<void>,
) => {
  const schools: string[] = [];
  try {
    await run(schools);
  } finally {
    await f.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const id of schools) {
        await tx`delete from media_release_club_attestations where organization_id=${id}`;
        await tx`delete from media_release_club_asks where organization_id=${id}`;
        await tx`delete from grants where organization_id=${id}`;
        await tx`delete from membership_periods where organization_id=${id}`;
        await tx`delete from memberships where organization_id=${id}`;
        await tx`delete from organizations where id=${id}`;
      }
    });
  }
};

/** A school with an owner and an active student. */
const school = async (
  f: Fixture,
  schools: string[],
  owner: Member,
  students: readonly Member[],
) => {
  const id = createId();
  schools.push(id);
  await f.sql`insert into organizations(id,kind,name,handle,owner_user_id)
    values(${id},'school','Lakeside Debate',${`lakeside-${id.slice(0, 8)}`},${owner.userId})`;
  for (const student of students)
    await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
      values(${id},${student.userId},'active',now())`;
  return id;
};

/** Mints a link for the mail of this kind, as the worker does, and returns its token. */
const mailLink = async (
  f: Fixture,
  store: Store,
  requestId: string,
  kind: 'request' | 'copy',
) => {
  const [mail] = await f.sql`select id from media_release_mails
    where request_id=${requestId} and kind=${kind} order by created_at desc limit 1`;
  const token = newReleaseLinkToken();
  const prepared = await store.prepareMediaReleaseMail({
    mailId: mail!.id as string,
    linkId: createId(),
    tokenDigest: releaseLinkDigest(
      kind === 'request' ? 'sign' : 'manage',
      token,
    ),
  });
  return { token, prepared: prepared.kind };
};

/**
 * Each test's release notices and their inbox signals go with it (ADR 0144):
 * the fixture drops its people later, and their signals would outlive them.
 */
const withNotices = async (f: Fixture, run: () => Promise<void>) => {
  try {
    await run();
  } finally {
    await f.sql`delete from notifications
      where kind like 'media_release_%'`;
    await deleteOrphanNotificationSignals(f.sql as never);
  }
};

const signForm = {
  name: 'Elena Rivera',
  relation: 'parent',
  attests: true,
  paidAds: false,
};

/** A minor asks a parent, who signs through the emailed link. */
const askAndSign = async (f: Fixture, store: Store, minor: Member) => {
  const asked = await store.mediaReleases.ask({
    userId: minor.userId,
    email: `parent-${minor.userId}@example.com`,
    recipientHash: 'a'.repeat(64),
  });
  const { token } = await mailLink(f, store, asked.requestId!, 'request');
  await store.mediaReleases.sign(releaseLinkDigest('sign', token), signForm);
  return asked.requestId!;
};

test('a parent signs and withdraws through single-use links, without an account', async () => {
  await withRoomRuntime(async (f) =>
    withNotices(f, async () => {
      const store = f.store as never as Store;
      await setAge(f, f.host, '16 years');
      const asked = await store.mediaReleases.ask({
        userId: f.host.userId,
        email: ' Elena.Rivera@Example.com ',
        recipientHash: 'b'.repeat(64),
      });
      const [request] =
        await f.sql`select recipient_email, outcome from media_release_requests where id=${asked.requestId!}`;
      const mails =
        await f.sql`select kind, next_attempt_at > now() + interval '2 days' as later
      from media_release_mails where request_id=${asked.requestId!} order by kind`;
      const { token, prepared } = await mailLink(
        f,
        store,
        asked.requestId!,
        'request',
      );
      const [stored] =
        await f.sql`select count(*)::int as n from media_release_links
      where token_digest = ${releaseLinkDigest('sign', token)}`;
      const [plain] =
        await f.sql`select count(*)::int as n from media_release_links
      where token_digest like ${`%${token}%`}`;
      assert({
        given: 'a youth member asking a parent’s address',
        should:
          'open a request with the normalised address, a request mail now and a reminder in 3 days, and keep only the link’s digest',
        actual: {
          asked: asked.kind,
          email: request!.recipient_email,
          outcome: request!.outcome,
          mails: mails.map((m: Record<string, unknown>) => [m.kind, m.later]),
          prepared,
          digestStored: stored!.n,
          tokenStored: plain!.n,
        },
        expected: {
          asked: 'asked',
          email: 'elena.rivera@example.com',
          outcome: null,
          mails: [
            ['reminder', true],
            ['request', false],
          ],
          prepared: 'owed',
          digestStored: 1,
          tokenStored: 0,
        },
      });

      const signed = await store.mediaReleases.sign(
        releaseLinkDigest('sign', token),
        {
          ...signForm,
          paidAds: true,
        },
      );
      const again = await store.mediaReleases.sign(
        releaseLinkDigest('sign', token),
        signForm,
      );
      const scopes =
        await f.sql`select scope, source, signer_name, wording_version
      from media_releases where user_id=${f.host.userId} and withdrawn_at is null order by scope`;
      const told =
        await f.sql`select kind from notifications where user_id=${f.host.userId}
      and kind like 'media_release_%' order by kind`;
      const reminder = await mailLink(f, store, asked.requestId!, 'request');
      assert({
        given:
          'the parent signing with paid ads ticked, then the link used again',
        should:
          'record both scopes once, refuse the second use, tell the minor, and owe no more sign mail',
        actual: {
          signed: signed.kind,
          again: again.reason,
          scopes: scopes.map((r: Record<string, unknown>) => [
            r.scope,
            r.source,
            r.signer_name,
            r.wording_version,
          ]),
          standing: (await store.mediaReleases.readMinorRelease(f.host.userId))
            .standing.kind,
          told: told.map((r: Record<string, unknown>) => r.kind),
          moreSignMail: reminder.prepared,
        },
        expected: {
          signed: 'done',
          again: 'used',
          scopes: [
            ['paid_ads', 'parent', 'Elena Rivera', '2026-11-v2'],
            ['publish', 'parent', 'Elena Rivera', '2026-11-v2'],
          ],
          standing: 'on_file',
          told: ['media_release_requested', 'media_release_signed'],
          moreSignMail: 'not-owed',
        },
      });

      const manage = await mailLink(f, store, asked.requestId!, 'copy');
      const withdrawn = await store.mediaReleases.withdraw(
        releaseLinkDigest('manage', manage.token),
        { what: 'whole', attests: true, note: 'Changed our minds' },
      );
      const rows =
        await f.sql`select scope, withdrawn_by, withdrawal_note from media_releases
      where user_id=${f.host.userId} order by scope`;
      const reused = await store.mediaReleases.withdraw(
        releaseLinkDigest('manage', manage.token),
        { what: 'whole', attests: true },
      );
      const signLinkAsManage = await store.mediaReleases.withdraw(
        releaseLinkDigest('manage', token),
        { what: 'whole', attests: true },
      );
      assert({
        given: 'the parent withdrawing the whole release from the copy’s link',
        should:
          'withdraw both scopes, keep the record, and refuse that link or a sign token used as a manage one',
        actual: {
          withdrawn: withdrawn.kind,
          rows: rows.map((r: Record<string, unknown>) => [
            r.scope,
            r.withdrawn_by,
            r.withdrawal_note,
          ]),
          standing: (await store.mediaReleases.readMinorRelease(f.host.userId))
            .standing.kind,
          reused: reused.reason,
          signLinkAsManage: signLinkAsManage.reason,
        },
        expected: {
          withdrawn: 'done',
          rows: [
            ['paid_ads', 'parent', 'Changed our minds'],
            ['publish', 'parent', 'Changed our minds'],
          ],
          standing: 'withdrawn',
          reused: 'used',
          signLinkAsManage: 'unknown',
        },
      });
    }),
  );
});

test('a club confirms releases for its Youth students, under row-level security', async () => {
  await withRoomRuntime(async (f) =>
    withNotices(f, () =>
      withSchools(f, async (schools) => {
        const store = f.store as never as Store;
        const owner = await f.member();
        const stranger = await f.member();
        await setAge(f, owner, '40 years');
        await setAge(f, stranger, '40 years');
        await setAge(f, f.host, '16 years');
        await setAge(f, f.guest, '17 years');
        const clubId = await school(f, schools, owner, [f.host, f.guest]);
        // The guest's parent signed and withdrew: only the parent can sign again.
        const requestId = await askAndSign(f, store, f.guest);
        const manage = await mailLink(f, store, requestId, 'copy');
        await store.mediaReleases.withdraw(
          releaseLinkDigest('manage', manage.token),
          {
            what: 'whole',
            attests: true,
          },
        );
        const form = {
          warrants: true,
          paidAds: false,
          name: 'Dana Mensah',
          role: 'Coach',
        };
        const confirm = (
          viewer: Member,
          students: readonly Member[],
          answer = form,
        ) =>
          store.mediaReleaseClubs.confirmClubReleases({
            viewerUserId: viewer.userId,
            organizationId: clubId,
            studentUserIds: students.map((s) => s.userId),
            form: answer,
          });
        const outsider = await confirm(stranger, [f.host]).catch(
          (error: unknown) =>
            error instanceof Error ? error.message : 'refused',
        );
        const withdrawnToo = await confirm(owner, [f.host, f.guest]);
        const noWarranty = await confirm(owner, [f.host], {
          ...form,
          warrants: false as never,
        });
        const confirmed = await confirm(owner, [f.host]);
        const fenced = await f.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          const [none] =
            await tx`select count(*)::int as n from media_release_club_attestations
          where user_id=${f.host.userId}`;
          await tx`select set_config('daisy.subject_scope', ${f.host.userId}, true)`;
          const [own] =
            await tx`select count(*)::int as n from media_release_club_attestations
          where user_id=${f.host.userId}`;
          return [none!.n, own!.n];
        });
        assert({
          given:
            'a stranger, a selection with a parent-withdrawn student, no warranty, then the owner confirming one student',
          should:
            'refuse the stranger, refuse the whole selection naming the withdrawn student, refuse without the warranty, and confirm the one, readable only under a scope',
          actual: {
            outsider: typeof outsider === 'string' ? 'refused' : outsider.kind,
            withdrawnToo: [withdrawnToo.reason, withdrawnToo.ineligible],
            noWarranty: noWarranty.reason,
            confirmed: confirmed.kind,
            standing: (
              await store.mediaReleases.readMinorRelease(f.host.userId)
            ).standing.kind,
            fenced,
          },
          expected: {
            outsider: 'refused',
            withdrawnToo: ['ineligible', [f.guest.userId]],
            noWarranty: 'invalid_form',
            confirmed: 'confirmed',
            standing: 'on_file',
            fenced: [0, 1],
          },
        });
      }),
    ),
  );
});

test('an address that stops release requests gets no reminder and no new request', async () => {
  await withRoomRuntime(async (f) =>
    withNotices(f, async () => {
      const store = f.store as never as Store;
      await setAge(f, f.host, '16 years');
      const hash = 'c'.repeat(64);
      const asked = await store.mediaReleases.ask({
        userId: f.host.userId,
        email: 'stop-me@example.com',
        recipientHash: hash,
      });
      await store.mediaReleases.stopRequests(hash);
      const [request] = await f.sql`select outcome from media_release_requests
        where id=${asked.requestId!}`;
      const reminder = await mailLink(f, store, asked.requestId!, 'request');
      const again = await store.mediaReleases.ask({
        userId: f.host.userId,
        email: 'stop-me@example.com',
        recipientHash: hash,
      });
      assert({
        given: 'an open request whose address then asks to stop',
        should:
          'close it, owe its mail nothing more, and refuse a new request to it',
        actual: {
          outcome: request!.outcome,
          moreMail: reminder.prepared,
          again: again.reason,
        },
        expected: {
          outcome: 'stopped',
          moreMail: 'not-owed',
          again: 'recipient_stopped',
        },
      });
      await f.sql`delete from media_release_stops where recipient_hash=${hash}`;
    }),
  );
});

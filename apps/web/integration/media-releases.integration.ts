import { daisyOrganizationId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { plannedRecording } from '@daisy/debate-engine';
import { isJudgeSeat, isModeratorSeat } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  roundEvidencePermissions,
  type RecordingRound,
  type RecordingViewer,
} from '../src/features/recording/audience';
import {
  newReleaseLinkToken,
  releaseLinkDigest,
} from '../src/features/media-releases/link-token';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { readyRankedRoom } from './ranked-room.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * PYL-6 and PYL-7 (ADR 0151) against the real database and its row-level
 * security: a minor asks, a parent signs and withdraws through single-use
 * hashed links, a club attests, and a Youth Recording becomes public only
 * when every youth debater holds a release and publishing is open.
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
  readonly youthRoundPublications: {
    readonly publishYouthRound: (c: {
      roundId: string;
      userId: string;
      open: boolean;
    }) => Promise<{ kind: string; reason?: string }>;
    readonly readYouthRoundShared: (roundId: string) => Promise<boolean>;
  };
  readonly prepareMediaReleaseMail: (i: {
    mailId: string;
    linkId: string;
    tokenDigest: string;
  }) => Promise<{ kind: string }>;
  readonly readRecordingRound: (
    roundId: string,
  ) => Promise<Parameters<typeof plannedRecording>[0] & Record<string, never>>;
  readonly readYouthRecordingPeople: (
    roundId: string,
  ) => Promise<{
    debaters: readonly {
      actorId: string;
      userId: string;
      linkedAdultActorIds: readonly string[];
    }[];
  }>;
  readonly readRecordingBroadcastRelease: (
    roundId: string,
    clock: ReturnType<typeof spectatorClockAt>,
  ) => Promise<never>;
  readonly listRecordingArchive: (
    input: never,
  ) => Promise<{ rows: readonly { id: string }[] }>;
};

const setAge = (f: Fixture, member: Member, age: string) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${age}::interval, 'YYYY-MM'), version = version + 1,
      recorded_at = now() - interval '1 second'
    where user_id = ${member.userId}`;

const withYouthSeason = async (f: Fixture, run: () => Promise<void>) => {
  const ids: string[] = [];
  try {
    for (const division of ['open', 'youth'] as const) {
      const id = createId();
      await f.sql`insert into seasons(organization_id,id,division,name,starts_at,status)
        values(${daisyOrganizationId},${id},${division},'Media release fixture',now() - interval '1 day','active')`;
      ids.push(id);
    }
    await run();
  } finally {
    for (const id of ids) {
      await f.sql`delete from agreement_signatures where season_id=${id}`;
      await f.sql`delete from seasons where id=${id}`;
    }
  }
};

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
      where kind like 'media_release_%' or kind = 'youth_round_published'`;
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

const viewerOf = (member: Member): RecordingViewer => ({
  kind: 'account',
  userId: member.userId,
  actorId: member.actorId,
});

/** The Round as the web composes it, public only while shared and publishing is open. */
const recordingRoundOf = async (
  store: Store,
  roundId: string,
  publishing: boolean,
): Promise<RecordingRound> => {
  const round = (await store.readRecordingRound(roundId)) as never as {
    id: string;
    competitionType: RecordingRound['competitionType'];
    visibility: RecordingRound['visibility'];
    audienceLinkHash: string | null;
    hostActorId: string | null;
    completedAtMs: number | null;
    seats: readonly {
      actorId: string;
      seat: Parameters<typeof isJudgeSeat>[0];
    }[];
  };
  const people = await store.readYouthRecordingPeople(roundId);
  const shared =
    await store.youthRoundPublications.readYouthRoundShared(roundId);
  return {
    id: round.id,
    competitionType: round.competitionType,
    visibility: round.visibility,
    audienceLinkHash: round.audienceLinkHash,
    hostActorId: round.hostActorId,
    completedAtMs: round.completedAtMs,
    seatedActorIds: round.seats.map((seat) => seat.actorId),
    recordingPolicy: plannedRecording(round as never),
    officialActorIds: round.seats
      .filter((seat) => isJudgeSeat(seat.seat) || isModeratorSeat(seat.seat))
      .map((seat) => seat.actorId),
    youth: { ...people, public: shared && publishing },
  };
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
            ['paid_ads', 'parent', 'Elena Rivera', '2026-11-v1'],
            ['publish', 'parent', 'Elena Rivera', '2026-11-v1'],
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
          rows: rows.map((r: Record<string, unknown>) => [r.scope, r.withdrawn_by, r.withdrawal_note]),
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

test('a Youth Recording is public only when every youth debater holds a release and publishing is open', async () => {
  await withRoomRuntime(async (f) =>
    withNotices(f, () =>
      withYouthSeason(f, async () => {
        const store = f.store as never as Store;
        await setAge(f, f.host, '16 years');
        await setAge(f, f.guest, '17 years');
        await setAge(f, f.outsider, '30 years');
        const room = await readyRankedRoom(f, 'freestyle', 'human');
        const { roundId } = await launchRuntimeRound(f, room);
        await f.sql`update rounds set status='completed', current_stage=null,
        started_at=coalesce(started_at, now()), winning_side='affirmative', completed_at=now()
        where id=${roundId}`;
        await f.sql.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`delete from recordings where round_id=${roundId}`;
        });
        await f.sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
        values (${createId()},${roundId},'ranked',${{ kind: 'ranked', youth: true }},'ready',${{ status: 'ready' }})`;
        const stranger = await f.member();
        const publish = (member: Member, open = true) =>
          store.youthRoundPublications.publishYouthRound({
            roundId,
            userId: member.userId,
            open,
          });
        const strangerSees = async (publishing: boolean) => {
          const round = await recordingRoundOf(store, roundId, publishing);
          const release = await store.readRecordingBroadcastRelease(
            roundId,
            spectatorClockAt(new Date().toISOString()),
          );
          return roundEvidencePermissions(
            round,
            release,
            viewerOf(stranger),
            null,
            Date.now(),
          ).media;
        };

        await askAndSign(f, store, f.host);
        const oneReleased = await publish(f.host);
        await askAndSign(f, store, f.guest);
        const flagClosed = await publish(f.host, false);
        const judge = await publish(f.outsider);
        const shared = await publish(f.guest);
        const told = await f.sql`select user_id from notifications
        where round_id=${roundId} and kind='youth_round_published'`;
        assert({
          given:
            'one release, then both with the flag closed, a judge, then a debater with both and the flag open',
          should:
            'refuse until every youth debater is released and publishing is open, let only a debater share, and tell the other debater',
          actual: {
            oneReleased: oneReleased.reason,
            flagClosed: flagClosed.reason,
            judge: judge.reason,
            shared: shared.kind,
            told: told.map((r: Record<string, unknown>) => r.user_id),
            strangerSeesOpen: await strangerSees(true),
            strangerSeesClosed: await strangerSees(false),
          },
          expected: {
            oneReleased: 'releases_missing',
            flagClosed: 'closed',
            judge: 'not_a_debater',
            shared: 'published',
            told: [f.host.userId],
            strangerSeesOpen: true,
            strangerSeesClosed: false,
          },
        });

        const [request] = await f.sql`select id from media_release_requests
        where user_id=${f.guest.userId} and outcome='signed' limit 1`;
        const manage = await mailLink(f, store, request!.id as string, 'copy');
        await store.mediaReleases.withdraw(
          releaseLinkDigest('manage', manage.token),
          {
            what: 'whole',
            attests: true,
          },
        );
        assert({
          given: 'one debater’s parent withdrawing after it was shared',
          should: 'take it back to private for anyone outside its audience',
          actual: {
            shared:
              await store.youthRoundPublications.readYouthRoundShared(roundId),
            strangerSees: await strangerSees(true),
          },
          expected: { shared: false, strangerSees: false },
        });
        await f.sql.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`delete from recordings where round_id=${roundId}`;
        });
      }),
    ),
  );
});

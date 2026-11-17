import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contentModerationOperations } from '../src/content-moderation-operations';
import { publicProfileOperations } from '../src/public-profile-operations';
import { publicProfilePrivacyAdopter } from '../src/public-profile-privacy';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const unfenced = async () => {};
const head = 'c'.repeat(64);
const now = '2026-11-16T10:00:00.000Z';
/** After any resolution a test makes: the database clock is today. */
const later = '2099-01-01T00:00:00.000Z';

type Context = {
  readonly f: Fixture;
  readonly client: SQL;
  readonly profiles: ReturnType<typeof publicProfileOperations>;
  readonly moderation: ReturnType<typeof contentModerationOperations>;
  readonly database: ReturnType<typeof drizzle>;
  readonly member: { readonly userId: string; readonly actorId: string };
};

const withProfiles = async (run: (context: Context) => Promise<void>) => {
  const client = new SQL(databaseUrl, { max: 4 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const database = drizzle({ client });
      const member = await createAuthorizationSubject(f);
      try {
        await run({
          f,
          client,
          database,
          member,
          profiles: publicProfileOperations({ database: database as never }),
          moderation: contentModerationOperations({
            database: database as never,
          }),
        });
      } finally {
        await client`delete from operator_command_receipts where admin_audit_head=${head}`;
        await client`delete from profile_photos where actor_id=${member.actorId}`;
        await client`delete from member_profiles where actor_id=${member.actorId}`;
      }
    });
  } finally {
    await client.close();
  }
};

const record = async (
  context: Context,
  status: 'published' | 'in_review',
  photoId = createId(),
) => {
  await context.profiles.reserveProfilePhoto(
    context.member,
    {
      photoId,
      objectPrefix: `profile-photos/${photoId}`,
      checkVerdict: status === 'published' ? 'allow' : null,
      now,
      deleteAfter: '2026-11-16T11:00:00.000Z',
    },
    unfenced,
  );
  const profile = await context.profiles.recordProfilePhoto(
    context.member,
    { photoId, status, now },
    unfenced,
  );
  return { photoId, profile };
};

const statuses = async (context: Context) =>
  (
    await context.client`select id, status, ended_at is not null as ended
      from profile_photos where actor_id=${context.member.actorId} order by created_at, id`
  )
    .map((row: { id: string; status: string; ended: boolean }) => [
      row.id,
      row.status,
      row.ended,
    ])
    .sort();

/** Rows as `statuses` reads them: sorted, since one instant orders nothing. */
const rowsOf = (rows: readonly (readonly [string, string, boolean])[]) =>
  [...rows].map((row) => [...row]).sort();

/** True when the statement is refused by the database. */
const refused = (statement: Promise<unknown>) =>
  statement.then(
    () => false,
    () => true,
  );

const command = (change: object) => ({
  commandId: createId(),
  serviceId: 'daisy-admin',
  operatorRef: 'o'.repeat(24),
  requestDigest: new Bun.CryptoHasher('sha256')
    .update(createId())
    .digest('hex'),
  adminAuditHead: head,
  live: () => true,
  change: change as never,
});

test('text: write, edit, clear; the profile id lasts', async () => {
  await withProfiles(async (context) => {
    const profileId = createId();
    const written = await context.profiles.writePublicProfileText(
      context.member,
      { profileId, displayName: 'Ada', bio: 'Policy debater', now },
      () => unfenced,
    );
    const again = await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Ada L', bio: null, now },
      () => unfenced,
    );
    const cleared = await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: null, bio: null, now },
      () => unfenced,
    );
    const [{ rows }] = await context.client`select count(*)::int as rows
      from member_profiles where actor_id=${context.member.actorId}`;
    assert({
      given: 'a first write, an edit and a clear',
      should:
        'keep the first profile id across edits, and leave no row once cleared',
      actual: {
        written: [written.profileId, written.displayName, written.bio],
        again: [again.profileId, again.displayName, again.bio],
        cleared: [cleared.profileId, cleared.displayName, cleared.bio],
        rows,
      },
      expected: {
        written: [profileId, 'Ada', 'Policy debater'],
        again: [profileId, 'Ada L', null],
        cleared: [profileId, null, null],
        rows: 1,
      },
    });
    assert({
      given: 'a display name past the CHECK bound written directly',
      should: 'be refused by the database',
      actual: await refused(
        context.client`insert into member_profiles (actor_id, id, display_name)
          values (${context.member.actorId}, ${createId()}, ${'x'.repeat(41)})`,
      ),
      expected: true,
    });
  });
});

test('photos: a published photo stays while its replacement is in review', async () => {
  await withProfiles(async (context) => {
    const first = await record(context, 'published');
    const review = await record(context, 'in_review');
    const secondReview = await record(context, 'in_review');
    const published = await record(context, 'published');
    assert({
      given: 'publish, upload for review twice, then publish again',
      should:
        'withdraw only the superseded photos and keep one per live status',
      actual: {
        afterReview: [review.profile.published, review.profile.inReview],
        afterSecond: [
          secondReview.profile.published,
          secondReview.profile.inReview,
        ],
        final: [published.profile.published, published.profile.inReview],
        rows: await statuses(context),
      },
      expected: {
        afterReview: [first.photoId, review.photoId],
        afterSecond: [first.photoId, secondReview.photoId],
        final: [published.photoId, null],
        rows: rowsOf([
          [first.photoId, 'withdrawn', true],
          [review.photoId, 'withdrawn', true],
          [secondReview.photoId, 'withdrawn', true],
          [published.photoId, 'published', false],
        ]),
      },
    });
    assert({
      given: 'a second published photo inserted directly',
      should: 'be refused by the one-published index',
      actual: await refused(
        context.client`insert into profile_photos (id, actor_id, status, object_prefix)
          values (${createId()}, ${context.member.actorId}, 'published', ${`profile-photos/${createId()}`})`,
      ),
      expected: true,
    });
  });
});

test('moderation: approve, reject, remove; stale versions conflict', async () => {
  await withProfiles(async (context) => {
    const live = await record(context, 'published');
    const pending = await record(context, 'in_review');
    const approve = await context.moderation.runModerationCommand(
      command({
        action: 'profile_photo.review',
        photoId: pending.photoId,
        expectedVersion: 2,
        outcome: 'approve',
      }),
    );
    const repeat = await context.moderation.runModerationCommand(
      command({
        action: 'profile_photo.review',
        photoId: pending.photoId,
        expectedVersion: 3,
        outcome: 'approve',
      }),
    );
    await assertRejects({
      given: 'a removal naming a version the operator did not read',
      should: 'conflict and change nothing',
      actual: () =>
        context.moderation.runModerationCommand(
          command({
            action: 'profile_photo.remove',
            photoId: pending.photoId,
            expectedVersion: 2,
            reason: 'policy_violation',
          }),
        ),
      code: 'CONFLICT',
    });
    const removed = await context.moderation.runModerationCommand(
      command({
        action: 'profile_photo.remove',
        photoId: pending.photoId,
        expectedVersion: 3,
        reason: 'policy_violation',
      }),
    );
    const rejected = await record(context, 'in_review');
    const reject = await context.moderation.runModerationCommand(
      command({
        action: 'profile_photo.review',
        photoId: rejected.photoId,
        expectedVersion: 2,
        outcome: 'reject',
      }),
    );
    assert({
      given:
        'an approval of a photo in review, its repeat, a removal and a rejection',
      should: 'publish it over the old one, answer unchanged, then end both',
      actual: {
        outcomes: [
          approve.outcome,
          repeat.outcome,
          removed.outcome,
          reject.outcome,
        ],
        rows: await statuses(context),
        queue: (await context.moderation.listProfilePhotoReviews()).filter(
          (row) => row.photoId === rejected.photoId,
        ),
      },
      expected: {
        outcomes: ['applied', 'unchanged', 'applied', 'applied'],
        rows: rowsOf([
          [live.photoId, 'withdrawn', true],
          [pending.photoId, 'removed', true],
          [rejected.photoId, 'rejected', true],
        ]),
        queue: [],
      },
    });
  });
});

test('moderation: a text field is cleared and the report sees it gone', async () => {
  await withProfiles(async (context) => {
    const written = await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Imposter', bio: 'Hello', now },
      () => unfenced,
    );
    const profileId = written.profileId!;
    const reporter = await createAuthorizationSubject(context.f);
    const reportFacts = (actorId: string) =>
      context.moderation.readReportTargetFacts({
        reporterUserId: reporter.userId,
        reporterActorId: actorId,
        report: {
          targetKind: 'profile_display_name',
          targetId: profileId,
          reason: 'impersonation',
        },
      });
    const before = [
      await reportFacts(reporter.actorId),
      await reportFacts(context.member.actorId),
    ];
    const outcome = await context.moderation.runModerationCommand(
      command({
        action: 'profile_text.remove',
        profileId,
        expectedVersion: 1,
        field: 'display_name',
        reason: 'impersonation',
      }),
    );
    const [row] =
      await context.client`select display_name, bio from member_profiles
      where id=${profileId}`;
    assert({
      given:
        'a display name reported by someone else and by its owner, then cleared',
      should:
        'admit the stranger, mark the owner, clear only that field and find it missing after',
      actual: {
        before,
        outcome: outcome.outcome,
        row,
        after: await reportFacts(reporter.actorId),
      },
      expected: {
        before: [
          { kind: 'profile', ownedByReporter: false },
          { kind: 'profile', ownedByReporter: true },
        ],
        outcome: 'applied',
        row: { display_name: null, bio: 'Hello' },
        after: { kind: 'missing' },
      },
    });
  });
});

test('erasure ends every photo and the sweep owes their images', async () => {
  await withProfiles(async (context) => {
    await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Ada', bio: null, now },
      () => unfenced,
    );
    const live = await record(context, 'published');
    const review = await record(context, 'in_review');
    const exported = await context.database.transaction((tx) =>
      publicProfilePrivacyAdopter.export(tx as never, context.member),
    );
    await context.database.transaction((tx) =>
      publicProfilePrivacyAdopter.erase(tx as never, context.member, { now }),
    );
    const due = await context.profiles.duePhotoDeletions({ now, limit: 100 });
    const mine = due.filter((photo) =>
      [live.photoId, review.photoId].includes(photo.photoId),
    );
    await context.profiles.deferPhotoDeletion(
      live.photoId,
      '2026-11-16T10:01:00.000Z',
    );
    await context.profiles.completePhotoDeletion(review.photoId);
    const [{ profiles }] = await context.client`select count(*)::int as profiles
      from member_profiles where actor_id=${context.member.actorId}`;
    assert({
      given: 'a member with text, a published and an in-review photo, erased',
      should:
        'export without storage keys, delete the text, end both photos as erased and owe each image',
      actual: {
        exportedTables: Object.keys(exported).sort(),
        exportedKeys: Object.keys(exported['profile_photos']![0]!).sort(),
        profiles,
        owed: mine.map((photo) => photo.photoId).sort(),
        rows: await statuses(context),
      },
      expected: {
        exportedTables: ['member_profiles', 'profile_photos'],
        exportedKeys: [
          'check_verdict',
          'created_at',
          'decided_at',
          'ended_at',
          'id',
          'status',
        ],
        profiles: 0,
        owed: [live.photoId, review.photoId].sort(),
        rows: [[live.photoId, 'erased', true]],
      },
    });
  });
});

test('cards: one statement for many members, published photo only', async () => {
  await withProfiles(async (context) => {
    await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Ada', bio: null, now },
      () => unfenced,
    );
    await record(context, 'in_review');
    const other = await createAuthorizationSubject(context.f);
    const cards = await context.profiles.readPublicProfileCards([
      context.member.actorId,
      other.actorId,
    ]);
    assert({
      given:
        'a member with a display name and only an in-review photo, and one with nothing',
      should: 'show the name and no photo, and an empty card',
      actual: [cards.get(context.member.actorId), cards.get(other.actorId)],
      expected: [
        { displayName: 'Ada', photoId: null },
        { displayName: null, photoId: null },
      ],
    });
  });
});

test('a repeat report of profile text reopens a resolved one once the text changed', async () => {
  await withProfiles(async (context) => {
    const written = await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Fine', bio: null, now },
      () => unfenced,
    );
    const reporter = await createAuthorizationSubject(context.f);
    const report = (reason: 'spam' | 'impersonation') =>
      context.moderation.fileReport({
        id: createId(),
        reporterUserId: reporter.userId,
        reporterActorId: reporter.actorId,
        report: {
          targetKind: 'profile_display_name',
          targetId: written.profileId!,
          reason,
        },
      });
    const state = async () =>
      (
        await context.client`select status, reason from content_reports
          where reporter_user_id = ${reporter.userId}`
      ).map((row: { status: string; reason: string }) => [
        row.status,
        row.reason,
      ]);
    try {
      await report('spam');
      const [{ id }] = await context.client`select id from content_reports
        where reporter_user_id = ${reporter.userId}`;
      await context.moderation.runModerationCommand(
        command({
          action: 'content_report.resolve',
          reportId: id,
          outcome: 'dismissed',
        }),
      );
      const dismissed = await state();
      await report('impersonation');
      const unchanged = await state();
      await context.profiles.writePublicProfileText(
        context.member,
        {
          profileId: createId(),
          displayName: 'Fine',
          bio: 'New bio',
          now: later,
        },
        () => unfenced,
      );
      await report('impersonation');
      const otherField = await state();
      await context.profiles.writePublicProfileText(
        context.member,
        {
          profileId: createId(),
          displayName: 'Imposter',
          bio: null,
          now: later,
        },
        () => unfenced,
      );
      await report('impersonation');
      const reopened = await state();
      await report('spam');
      assert({
        given:
          'a dismissed report of a display name, reported again unchanged, after only the bio changed, after the name changed, and once more while open',
        should:
          'keep it dismissed until the name itself changed, then reopen it with the new reason, and leave an open one as it is',
        actual: {
          dismissed,
          unchanged,
          otherField,
          reopened,
          open: await state(),
        },
        expected: {
          dismissed: [['dismissed', 'spam']],
          unchanged: [['dismissed', 'spam']],
          otherField: [['dismissed', 'spam']],
          reopened: [['open', 'impersonation']],
          open: [['open', 'impersonation']],
        },
      });
    } finally {
      await context.client`delete from content_reports where reporter_user_id = ${reporter.userId}`;
    }
  });
});

test('the withdraw decision reads the text inside the write, after an operator removal', async () => {
  await withProfiles(async (context) => {
    const written = await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Removed', bio: null, now },
      () => unfenced,
    );
    await context.moderation.runModerationCommand(
      command({
        action: 'profile_text.remove',
        profileId: written.profileId,
        expectedVersion: 1,
        field: 'display_name',
        reason: 'impersonation',
      }),
    );
    const seen: unknown[] = [];
    await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Removed', bio: null, now },
      (current) => {
        seen.push(current);
        return unfenced;
      },
    );
    assert({
      given: 'a member resubmitting a name an operator has just removed',
      should:
        'choose the fence from the removed state, so resubmitting it is a new name, not a kept one',
      actual: seen,
      expected: [{ displayName: null, bio: null }],
    });
  });
});

test('two first uploads at once queue, and the later one replaces the earlier', async () => {
  await withProfiles(async (context) => {
    const [first, second] = await Promise.all([
      record(context, 'published'),
      record(context, 'published'),
    ]);
    const rows = (await statuses(context)) as [string, string, boolean][];
    assert({
      given: 'a member with no photo uploading twice at once',
      should:
        'record both, leaving exactly one published and the other withdrawn',
      actual: {
        ids: rows.map(([id]) => id).sort(),
        live: rows.filter(([, status]) => status === 'published').length,
        withdrawn: rows.filter(([, status]) => status === 'withdrawn').length,
      },
      expected: {
        ids: [first.photoId, second.photoId].sort(),
        live: 1,
        withdrawn: 1,
      },
    });
  });
});

test('an upload that never finishes is owed only once its reservation lapses', async () => {
  await withProfiles(async (context) => {
    const photoId = createId();
    await context.profiles.reserveProfilePhoto(
      context.member,
      {
        photoId,
        objectPrefix: `profile-photos/${photoId}`,
        checkVerdict: null,
        now,
        deleteAfter: '2026-11-16T11:00:00.000Z',
      },
      unfenced,
    );
    const due = async (at: string) =>
      (await context.profiles.duePhotoDeletions({ now: at, limit: 500 }))
        .map((photo) => photo.photoId)
        .includes(photoId);
    const shown = await context.profiles.readOwnPublicProfile(
      context.member,
      unfenced,
    );
    assert({
      given: 'a reserved photo whose objects never finished storing',
      should:
        'show nowhere, not be due before its reservation lapses, and be due after',
      actual: {
        shown: [shown.published, shown.inReview],
        before: await due('2026-11-16T10:30:00.000Z'),
        after: await due('2026-11-16T11:00:00.000Z'),
      },
      expected: { shown: [null, null], before: false, after: true },
    });
    await context.profiles.completePhotoDeletion(photoId);
    await assertRejects({
      given: 'a record of a reservation the sweep already took',
      should: 'conflict and publish nothing',
      actual: () =>
        context.profiles.recordProfilePhoto(
          context.member,
          { photoId, status: 'published', now },
          unfenced,
        ),
      code: 'CONFLICT',
    });
  });
});

test('a text change waiting on a lock is timed after the lock is released', async () => {
  await withProfiles(async (context) => {
    await context.profiles.writePublicProfileText(
      context.member,
      { profileId: createId(), displayName: 'Before', bio: null, now },
      () => unfenced,
    );
    const holder = new SQL(databaseUrl, { max: 1 });
    try {
      let releasedAt = '';
      const held = holder.begin(async (tx) => {
        await tx`select 1 from member_profiles where actor_id = ${context.member.actorId} for update`;
        await Bun.sleep(150);
        const [row] = await tx`select clock_timestamp() as at`;
        releasedAt = new Date(row.at).toISOString();
      });
      await Bun.sleep(30);
      // Starts while the holder has the row: its transaction begins earlier
      // than the holder's release, its statement runs after it.
      const write = context.profiles.writePublicProfileText(
        context.member,
        { profileId: createId(), displayName: 'After', bio: null, now },
        () => unfenced,
      );
      await held;
      await write;
      const [row] = await context.client`select display_name_changed_at as at
        from member_profiles where actor_id = ${context.member.actorId}`;
      assert({
        given: 'a name change that waited on a row another transaction held',
        should: 'carry a change time after that transaction released the row',
        actual: new Date(row.at).getTime() >= new Date(releasedAt).getTime(),
        expected: true,
      });
    } finally {
      await holder.close();
    }
  });
});

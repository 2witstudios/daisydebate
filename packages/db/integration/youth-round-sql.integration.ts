import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { isYouthRound, type RatingDivision } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import {
  mediaReleaseWording,
  reuseFenced,
} from '@daisy/protocol/media-release';
import { youthReuseFencedSql, youthRoundSql } from '../src/youth-round-sql';
import { readStudentLiveRounds } from '../src/youth-students-live';
import { readYouthRecordingPeople } from '../src/youth-recording-people';
import { accountAgePrivacyAdopter } from '../src/account-age';
import { mediaReleasePrivacyAdopter } from '../src/media-release-privacy';
import { createLobbyPermissionStore } from '../src/guardians/lobby-requests';
import { createAuthorizationSubject } from './authorization.test-support';
import { Fixture, withFixture } from './constraint-helpers';
import { scratchDatabase } from './scratch-migrations.test-support';
import { validConfig } from './round-fixtures';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
const { databaseUrl } = integrationSuite();

test('guardian play permission in an adult lobby never supplies media release', async () => {
  const scratch = scratchDatabase(databaseUrl, 'lobbyreuse');
  await scratch.create();
  const client = new SQL(scratch.url);
  try {
    await scratch.migrate(() => true);
    const f = new Fixture(client);
    const adult = await createAuthorizationSubject(f);
    const minor = await createAuthorizationSubject(f);
    const opponent = await createAuthorizationSubject(f);
    const visitor = await createAuthorizationSubject(f);
    await f.sql`update account_age set birth_month=to_char(now()-interval '14 years','YYYY-MM')
      where user_id=${minor.userId}`;
    const [owner] = await f.sql`select id from organizations where official`;
    const lobbyId = createId();
    await f.insert('lobbies', {
      id: lobbyId,
      name: 'Adult standing',
      handle: lobbyId,
      kind: 'standing',
      owner_organization_id: owner!.id,
      age_rule: 'adults',
    });
    const evidenceId = createId();
    await f.insert('guardian_consent_evidence', {
      id: evidenceId,
      person_user_id: adult.userId,
      role: 'guardian',
      method: 'created-account',
      notice_kind: 'parental-consent',
      notice_version: 'fixture',
      notice_digest: 'e'.repeat(64),
      recorded_at: new Date(),
    });
    const linkId = createId();
    const linkedAt = new Date();
    await f.insert('guardian_links', {
      id: linkId,
      guardian_user_id: adult.userId,
      minor_user_id: minor.userId,
      guardian_consent_id: evidenceId,
      status: 'active',
      activation: 'created-account',
      activated_at: linkedAt,
      created_at: linkedAt,
    });
    const db = drizzle({ client: f.sql });
    const store = createLobbyPermissionStore(db);
    const requested = await store.apply(minor, {
      type: 'request',
      linkId,
      lobbyId,
    });
    const allowed = await store.apply(adult, {
      type: 'sign',
      linkId,
      lobbyId,
      version: 'play-waiver',
      digest: 'a'.repeat(64),
    });
    const formatId = await f.format();
    const roomId = await f.room(opponent.actorId, formatId, {
      lobby_id: lobbyId,
      visibility: 'public',
    });
    await f.sql`insert into room_participants(id,room_id,actor_id,seat_kind,side,slot) values
      (${createId()},${roomId},${opponent.actorId},'side','affirmative',0),
      (${createId()},${roomId},${minor.actorId},'side','negative',0)`;
    const [chat] = await f.sql`select youth_room, youth_staff
      from public.daisy_room_community_fact(${roomId}, ${visitor.actorId})`;
    assert({
      given: 'a seated youth debater and a seatless visitor in an adult lobby',
      should: 'preserve the Open Room chat policy',
      actual: chat,
      expected: { youth_room: false, youth_staff: false },
    });
    await f.sql`update rooms set visibility='private' where id=${roomId}`;
    const [cast] =
      await f.sql`select public.daisy_room_youth_recording_cast(${roomId}) as youth`;
    const { id: roundId } = await f.roundWithCast(
      {
        room_id: roomId,
        format_id: formatId,
        room_config_snapshot: validConfig,
        visibility: 'private',
        standing_age_rule: 'adults',
        standing_youth_cast: cast?.youth,
      },
      [
        { seat: 'affirmative', actorId: opponent.actorId },
        { seat: 'negative', actorId: minor.actorId },
      ],
    );
    const watched = async (userId: string, scope: string) =>
      (await readStudentLiveRounds(db, userId, scope)).map(
        ({ roundId }) => roundId,
      );
    assert({
      given: 'a private mixed-age Open Round with a linked youth debater',
      should: 'list it on Watch for the guardian in that lobby',
      actual: [
        await watched(adult.userId, lobbyId),
        await watched(adult.userId, createId()),
        await watched(visitor.userId, lobbyId),
      ],
      expected: [[roundId], [], []],
    });
    const fence = async () =>
      (
        await db.execute(
          sql`select ${youthReuseFencedSql(sql`${roundId}`)} as fenced`,
        )
      )[0]?.fenced;
    const withoutRelease = await fence();
    await f.insert('media_releases', {
      id: createId(),
      user_id: minor.userId,
      scope: 'publish',
      source: 'parent',
      signer_name: 'Fixture Parent',
      signer_relation: 'parent',
      signer_email: 'fixture@example.test',
      wording_version: mediaReleaseWording.version,
      signed_at: new Date(),
    });
    const withRelease = await fence();
    await f.sql`update lobbies set age_rule='under-18' where id=${lobbyId}`;
    const afterLobbyChange = await fence();
    const { debaters } = await readYouthRecordingPeople(db, roundId);
    assert({
      given: 'the adult lobby changed to under-18 after a mixed-age Round',
      should:
        'keep the recorded youth debater as the only linked-adult and release subject',
      actual: {
        fenced: afterLobbyChange,
        users: debaters.map(({ userId }) => userId),
      },
      expected: { fenced: false, users: [minor.userId] },
    });
    await db.transaction(async (tx) => {
      const context = { now: new Date().toISOString() };
      await mediaReleasePrivacyAdopter.erase(tx, minor, context);
      await accountAgePrivacyAdopter.erase(tx, minor, context);
    });
    assert({
      given: 'a mixed adult-lobby cast with a guardian play signature',
      should:
        'deny media reuse until the youth debater has a separate publish release',
      actual: [
        requested,
        allowed,
        cast?.youth,
        withoutRelease,
        withRelease,
        await fence(),
      ],
      expected: [true, true, true, true, false, true],
    });
  } finally {
    await client.close();
    await scratch.drop();
  }
});

test('a private mixed-age Round keeps Youth reuse and linked-adult rules after the lobby changes', async () => {
  await withFixture(databaseUrl, async (f) => {
    const adult = await createAuthorizationSubject(f);
    const minor = await createAuthorizationSubject(f);
    await f.sql`update account_age set birth_month=to_char(now()-interval '16 years','YYYY-MM')
      where user_id=${minor.userId}`;
    const [owner] = await f.sql`select id from organizations where official`;
    const lobbyId = createId();
    await f.insert('lobbies', {
      id: lobbyId,
      name: 'All ages',
      handle: lobbyId,
      kind: 'standing',
      owner_organization_id: owner!.id,
      age_rule: 'anyone',
    });
    const formatId = await f.format();
    const roomId = await f.room(adult.actorId, formatId, { lobby_id: lobbyId });
    const { id: roundId } = await f.roundWithCast(
      {
        room_id: roomId,
        room_config_snapshot: validConfig,
        visibility: 'private',
        standing_age_rule: 'anyone',
        standing_youth_cast: true,
        format_id: formatId,
      },
      [
        { seat: 'affirmative', actorId: adult.actorId },
        { seat: 'negative', actorId: minor.actorId },
      ],
    );
    const db = drizzle({ client: f.sql });
    await f.sql`update lobbies set age_rule='adults' where id=${lobbyId}`;
    const facts = async () => {
      const [row] = await db.execute(sql`select
        ${youthReuseFencedSql(sql`${roundId}`)} as fenced`);
      return row?.fenced;
    };
    const beforeRelease = await facts();
    const people = await readYouthRecordingPeople(db, roundId);
    await f.sql`insert into media_releases (id,user_id,scope,source,signer_name,signer_relation,signer_email,wording_version,signed_at)
      values (${createId()},${minor.userId},'publish','parent','A Parent','parent','parent@example.test',${mediaReleaseWording.version},now())`;
    assert({
      given:
        'an adult and a minor debated privately before the anyone lobby became adults-only',
      should:
        'expose only the minor to linked-adult lookup and require only that minor’s release for reuse',
      actual: [
        people.debaters.map(({ actorId }) => actorId),
        beforeRelease,
        await facts(),
      ],
      expected: [[minor.actorId], true, false],
    });
    await db.transaction(async (tx) => {
      const context = { now: new Date().toISOString() };
      await mediaReleasePrivacyAdopter.erase(tx, minor, context);
      await accountAgePrivacyAdopter.erase(tx, minor, context);
    });
    assert({
      given: 'the minor’s age evidence and active release removed by erasure',
      should:
        'fence reuse of the retained Round without granting any linked-adult access',
      actual: [
        await facts(),
        (await readYouthRecordingPeople(db, roundId)).debaters,
      ],
      expected: [true, []],
    });
  });
});

/**
 * ADR 0157: `youthRoundSql` is the SQL mirror of `isYouthRound`. Every Room
 * division (and no Room) against every ladder (none, Open, Youth) gives the
 * same answer in SQL as in the rule.
 */
const lobbyFor = async (
  f: Pick<import('./constraint-helpers').Fixture, 'sql'>,
  band: 'open' | 'youth',
) => {
  const ageRule = band === 'youth' ? 'under-18' : 'adults';
  const [lobby] =
    await f.sql`select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
    where o.official and l.age_rule=${ageRule}`;
  return lobby!.id;
};

test('youthRoundSql agrees with isYouthRound on every Room and ladder', async () => {
  await withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    // A ranked Round rates on a ladder, which needs the Freestyle preset.
    const [preset] =
      await f.sql`select format_version, version from format_presets where format_id='freestyle' and superseded_at is null`;
    const ranked = {
      format_id: 'freestyle',
      format_version: preset!.format_version,
      preset_version: preset!.version,
    };
    const rooms = [null, 'open', 'youth'] as const;
    const ladders = [null, 'open', 'youth'] as const;
    const cases: {
      readonly room: RatingDivision | null;
      readonly ladder: RatingDivision | null;
      readonly roundId: string;
    }[] = [];
    for (const room of rooms)
      for (const ladder of ladders) {
        const roomId =
          room === null
            ? null
            : await f.room(caller.actorId, formatId, {
                lobby_id: await lobbyFor(f, room),
                competition_type: ladder === null ? 'casual' : 'ranked',
                ...(ladder === null ? {} : ranked),
              });
        const roundId = await f.round({
          room_id: roomId,
          // A Room's Round freezes what the Room set (rounds_room_freeze_complete).
          ...(roomId === null
            ? {}
            : { room_config_snapshot: validConfig, visibility: 'public' }),
          ...(ladder === null ? { format_id: formatId } : ranked),
          competition_type: ladder === null ? 'casual' : 'ranked',
          ladder_id: ladder === null ? null : 'freestyle',
          ladder_division: ladder,
        });
        cases.push({ room, ladder, roundId });
      }
    const db = drizzle({ client: f.sql });
    const inSql = async (roundId: string) => {
      const [row] = (await db.execute(
        sql`select ${youthRoundSql(sql`${roundId}`)} as youth`,
      )) as unknown as { youth: boolean }[];
      return row!.youth;
    };
    const label = (room: string | null, ladder: string | null) =>
      `${room ?? 'no Room'} × ${ladder ?? 'no ladder'}`;
    const actual: Record<string, boolean> = {};
    const expected: Record<string, boolean> = {};
    for (const { room, ladder, roundId } of cases) {
      actual[label(room, ladder)] = await inSql(roundId);
      expected[label(room, ladder)] = isYouthRound(
        { ladderDivision: ladder },
        room === null ? null : room === 'youth',
      );
    }
    assert({
      given: 'a Round for every Room division and ladder, and none',
      should: 'answer in SQL exactly as the rule does',
      actual,
      expected,
    });
    assert({
      given: 'the same table',
      should:
        'be Youth whenever its Room or its ladder is, and only then (fail closed)',
      actual: Object.entries(expected)
        .filter(([, youth]) => youth)
        .map(([key]) => key),
      expected: [
        'no Room × youth',
        'open × youth',
        'youth × no ladder',
        'youth × open',
        'youth × youth',
      ],
    });
  });
});

/**
 * ADR 0161: `youthReuseFencedSql` is the SQL mirror of `reuseFenced`. A Youth
 * Round and an Open Round, each with no debater, two unreleased, one released,
 * both released, one withdrawn and one holding paid ads alone, give the same
 * answer in SQL as in the rule; a release outside its seats never counts.
 */
test('youthReuseFencedSql agrees with reuseFenced on every release standing', async () => {
  await withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    const standings = [
      'no debater',
      'none released',
      'one released',
      'both released',
      'one withdrawn',
      'paid ads only',
      'old wording',
    ] as const;
    type Standing = (typeof standings)[number];
    const release = (
      userId: string,
      scope: 'publish' | 'paid_ads',
      withdrawn = false,
      wordingVersion: string = mediaReleaseWording.version,
    ) =>
      f.sql`insert into media_releases (id,user_id,scope,source,signer_name,signer_relation,signer_email,wording_version,signed_at,withdrawn_at,withdrawn_by)
        values (${createId()},${userId},${scope},'parent','A Parent','parent','parent@example.test',${wordingVersion},now() - interval '1 day',${withdrawn ? new Date() : null},${withdrawn ? 'parent' : null})`;
    const facts: {
      readonly label: string;
      readonly roundId: string;
      readonly youth: boolean;
      readonly debaterUserIds: readonly string[];
      readonly releases: {
        readonly subjectUserId: string;
        readonly scope: 'publish' | 'paid_ads';
        readonly withdrawnAt: string | null;
        readonly wordingVersion: string;
      }[];
    }[] = [];
    for (const division of ['open', 'youth'] as const)
      for (const standing of standings as readonly Standing[]) {
        const roomId = await f.room(caller.actorId, formatId, {
          lobby_id: await lobbyFor(f, division),
        });
        const debaterUserIds: string[] =
          standing === 'no debater' ? [] : [await f.user(), await f.user()];
        const cast = [];
        for (const [index, userId] of debaterUserIds.entries())
          cast.push({
            seat: index === 0 ? 'affirmative' : 'negative',
            actorId: await f.actor(userId),
          });
        const { id: roundId } = await f.roundWithCast(
          {
            room_id: roomId,
            room_config_snapshot: validConfig,
            visibility: 'public',
            format_id: formatId,
            competition_type: 'casual',
            ladder_id: null,
            ladder_division: null,
          },
          cast,
        );
        const releases: (typeof facts)[number]['releases'] = [];
        // Someone outside its debating seats holds a release: it never counts.
        await release(await f.user(), 'publish');
        const [first, second] = debaterUserIds;
        const grant = async (
          userId: string,
          scope: 'publish' | 'paid_ads',
          withdrawn = false,
          wordingVersion: string = mediaReleaseWording.version,
        ) => {
          await release(userId, scope, withdrawn, wordingVersion);
          releases.push({
            subjectUserId: userId,
            scope,
            wordingVersion,
            withdrawnAt: withdrawn ? new Date().toISOString() : null,
          });
        };
        if (standing === 'one released') await grant(first!, 'publish');
        if (standing === 'both released') {
          await grant(first!, 'publish');
          await grant(second!, 'publish');
        }
        if (standing === 'one withdrawn') {
          await grant(first!, 'publish');
          await grant(second!, 'publish', true);
        }
        if (standing === 'paid ads only') {
          await grant(first!, 'paid_ads');
          await grant(second!, 'paid_ads');
        }
        if (standing === 'old wording') {
          await grant(first!, 'publish');
          await grant(second!, 'publish', false, '2026-11-v1');
        }
        facts.push({
          label: `${division} × ${standing}`,
          roundId,
          youth: division === 'youth',
          debaterUserIds,
          releases,
        });
      }
    const db = drizzle({ client: f.sql });
    const actual: Record<string, boolean> = {};
    const expected: Record<string, boolean> = {};
    for (const fact of facts) {
      const [row] = (await db.execute(
        sql`select ${youthReuseFencedSql(sql`${fact.roundId}`)} as fenced`,
      )) as unknown as { fenced: boolean }[];
      actual[fact.label] = row!.fenced;
      expected[fact.label] = reuseFenced(fact);
    }
    assert({
      given:
        'an Open and a Youth Round for every release standing of their debaters',
      should: 'answer in SQL exactly as the rule does',
      actual,
      expected,
    });
    assert({
      given: 'the same table',
      should:
        'fence only Youth Rounds, and lift the fence only when every youth debater holds an active release',
      actual: Object.entries(expected)
        .filter(([, fenced]) => fenced)
        .map(([key]) => key),
      expected: [
        'youth × no debater',
        'youth × none released',
        'youth × one released',
        'youth × one withdrawn',
        'youth × paid ads only',
        'youth × old wording',
      ],
    });
  });
});

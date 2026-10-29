import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { ratingLadders } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { createAuthorizationSubject } from './authorization.test-support';
import { rejectedBy, withFixture, type Fixture } from './constraint-helpers';
import { played } from './member-profile.test-support';
import { bindings, now } from './privacy.test-support';
import { validConfig, validRules } from './round-fixtures';
import { at, change, rating, season } from './standings-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** No Room is open in this proof, so the engine's transitions never run. */
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

test('closing an account through every feature step keeps the competitive record and what alt detection matches on (ADR 0087)', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const email = `${subject.userId}@closure.invalid`;
    await fixture.sql`update users set email=${email}, name='Private name', image='private-image' where id=${subject.userId}`;
    const recipientHash = createId().padEnd(64, '0');
    await fixture.sql`insert into email_suppression (recipient_hash, reason, provider_message_id)
      values (${recipientHash}, 'bounce', ${createId()})`;
    const round = await played(fixture, {
      member: subject.actorId,
      side: 'affirmative',
      outcome: 'affirmative',
      day: 1,
    });
    const resolution = async () =>
      (await fixture.sql`select resolution from rounds where id=${round.id}`)[0]
        ?.resolution;
    const before = await resolution();
    const other = await createAuthorizationSubject(fixture);
    try {
      const database = drizzle({ client: fixture.sql });
      const exported = await exportPrivacySubject(database, subject, rooms);
      assert({
        given:
          'two members, one exporting their data through every feature step',
        should:
          'return their own account and beta rows and nothing of the other member',
        actual: [
          exported.users?.map((row) => [row.id, row.email]),
          exported.account_beta_access?.map((row) => row.user_id),
          JSON.stringify(exported).includes(other.userId),
        ],
        expected: [[[subject.userId, email]], [subject.userId], false],
      });
      const result = await erasePrivacySubject(
        database,
        { subject, now, vendors: [], jobIds: [] },
        rooms,
        bindings,
      );
      const [account] =
        await fixture.sql`select id, username, email, name, image, deleted_at is not null as closed from users where id=${subject.userId}`;
      const [actor] =
        await fixture.sql`select user_id from actors where id=${subject.actorId}`;
      const [suppression] =
        await fixture.sql`select count(*)::int as n from email_suppression where recipient_hash=${recipientHash}`;
      const [beta] =
        await fixture.sql`select count(*)::int as n from account_beta_access where user_id=${subject.userId}`;
      const reclaim = await rejectedBy(() =>
        fixture.insert('users', {
          id: createId(),
          username: subject.userId.toUpperCase(),
        }),
      );
      assert({
        given:
          'a member with an email, a bounce suppression, beta access and a played Round',
        should:
          'delete the email, name, image and beta state, and keep the account row id, username, actor link, suppression hash and resolution, with the username never reclaimable in any casing',
        actual: {
          alreadyErased: result.alreadyErased,
          account,
          actor: actor?.user_id,
          suppression: suppression?.n,
          beta: beta?.n,
          resolution: await resolution(),
          reclaim,
        },
        expected: {
          alreadyErased: false,
          account: {
            id: subject.userId,
            username: subject.userId,
            email: null,
            name: '',
            image: null,
            closed: true,
          },
          actor: subject.userId,
          suppression: 1,
          beta: 0,
          resolution: before,
          reclaim: 'users_username_lower_unique',
        },
      });
    } finally {
      await fixture.sql`delete from email_suppression where recipient_hash=${recipientHash}`;
    }
  });
});

test('exporting a member includes their competitive record and nothing of another member (ISSUE-833)', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const other = await createAuthorizationSubject(fixture);
    const seasonId = await season(fixture, 'active', at(1));
    const mine = await played(fixture, {
      member: subject.actorId,
      side: 'affirmative',
      outcome: 'affirmative',
      day: 2,
    });
    const theirs = await played(fixture, {
      member: other.actorId,
      side: 'affirmative',
      outcome: 'negative',
      day: 2,
    });
    // A rating change posts to its round's own format (the composite FK),
    // so each side reads the format its played Round resolved against.
    const roundFormat = async (roundId: string) =>
      (
        await fixture.sql`select format_id as "formatId" from rounds where id=${roundId}`
      )[0].formatId as string;
    const formatId = await roundFormat(mine.id);
    const otherFormat = await roundFormat(theirs.id);
    const hostedRoom = createId();
    await fixture.insert('rooms', {
      id: hostedRoom,
      host_actor_id: subject.actorId,
      title: 'Mine',
      topic: 'Motion',
      visibility: 'public',
      format_id: formatId,
      format_version: 1,
      competition_type: 'casual',
      config: validConfig,
      execution_plan: {},
      rules_snapshot: validRules,
      status: 'assembling',
    });
    const judgedRound = await fixture.round({
      status: 'completed',
      outcome: 'affirmative',
      started_at: at(3, 11),
      completed_at: at(3),
    });
    const judgeSeat = await fixture.seat(
      judgedRound,
      'judge',
      0,
      subject.actorId,
    );
    await fixture.freeze(judgedRound);
    const ballotId = createId();
    await fixture.insert('ballots', {
      id: ballotId,
      judge_participant_id: judgeSeat.id,
      round_id: judgedRound,
      freeze_revision: 1,
      rubric_version: 'speaker-10@1',
      winner: 'affirmative',
      scores: {},
      reason: 'Mine',
      status: 'submitted',
      submitted_at: at(3),
    });
    // The ladder name comes from the protocol's own catalog, so the fixture
    // can never drift from the merged ratings vocabulary.
    const ladder = ratingLadders[0];
    await rating(fixture, {
      actorId: subject.actorId,
      formatId,
      seasonId,
      ladder,
      rating: 1520,
    });
    await change(fixture, {
      roundId: mine.id,
      actorId: subject.actorId,
      formatId,
      seasonId,
      ladder,
      before: 1500,
      after: 1520,
      occurredAt: at(3),
    });
    await rating(fixture, {
      actorId: other.actorId,
      formatId: otherFormat,
      seasonId,
      ladder,
      rating: 1490,
    });
    await change(fixture, {
      roundId: theirs.id,
      actorId: other.actorId,
      formatId: otherFormat,
      seasonId,
      ladder,
      before: 1500,
      after: 1490,
      occurredAt: at(3),
    });
    // A draw over the subject's hosted Room, with one strike they authored
    // and one authored by the other member in their own Room's draw: the
    // export must return exactly the subject's.
    const draw = (
      fixture: Fixture,
      room: string,
      striker: string,
    ): Promise<string> => {
      const id = createId();
      return (async () => {
        await fixture.insert('room_resolution_draws', {
          id,
          room_id: room,
          source_kind: 'host',
          draw_size: 2,
          manifest: {
            version: 1,
            algorithm: 'daisy-draw-v1',
            roomId: room,
            drawId: id,
            source: { kind: 'host', count: 2 },
            drawSize: 2,
            firstStriker: 'affirmative',
            strikeWindowMs: 10_000,
            controllers: { affirmative: 'human', negative: 'human' },
            inputCommitment: '0'.repeat(64),
          },
          manifest_digest: '0'.repeat(64),
          commitment: '0'.repeat(64),
          seed: '1'.repeat(64),
          started_at: at(2),
        });
        await fixture.insert('room_resolution_draw_items', {
          draw_id: id,
          position: 0,
          source_kind: 'host',
          draw_size: 2,
          candidate_id: createId(),
          text: 'A hosted resolution',
        });
        await fixture.insert('room_resolution_strikes', {
          draw_id: id,
          ordinal: 0,
          position: 0,
          draw_size: 2,
          side: 'affirmative',
          kind: 'debater',
          actor_id: striker,
          command_id: createId(),
          struck_at: at(3),
        });
        return id;
      })();
    };
    const subjectStrike = await draw(fixture, hostedRoom, subject.actorId);
    const otherRoom = createId();
    await fixture.insert('rooms', {
      id: otherRoom,
      host_actor_id: other.actorId,
      title: 'Theirs',
      topic: 'Motion',
      visibility: 'public',
      format_id: otherFormat,
      format_version: 1,
      competition_type: 'casual',
      config: validConfig,
      execution_plan: {},
      rules_snapshot: validRules,
      status: 'assembling',
    });
    const otherStrike = await draw(fixture, otherRoom, other.actorId);
    const database = drizzle({ client: fixture.sql });
    const exported = await exportPrivacySubject(database, subject, rooms);
    const ids = (
      rows?: readonly Readonly<Record<string, unknown>>[],
    ): unknown[] => (rows ?? []).map((row) => row.id);
    assert({
      given:
        'two members with played Rounds, ratings and one judged ballot, one exporting',
      should:
        'export the hosted Rooms, the Round seats, the Rounds sat and judged, the ballots and the ratings, and nothing of the other member',
      actual: {
        rooms: ids(exported.rooms),
        rounds: ids(exported.rounds),
        roundSeats: (exported.round_participants ?? []).map(
          (row) => row.actor_id,
        ),
        ballots: ids(exported.ballots),
        ratingActors: (exported.ratings ?? []).map((row) => row.actor_id),
        changeActors: (exported.rating_changes ?? []).map(
          (row) => row.actor_id,
        ),
        strikes: (exported.room_resolution_strikes ?? []).map((row) => [
          row.draw_id,
          row.actor_id,
        ]),
        leaksOtherMember: JSON.stringify(exported).includes(other.actorId),
      },
      expected: {
        rooms: [hostedRoom],
        rounds: [mine.id, judgedRound],
        roundSeats: [subject.actorId, subject.actorId],
        ballots: [ballotId],
        ratingActors: [subject.actorId],
        changeActors: [subject.actorId],
        strikes: [[subjectStrike, subject.actorId]],
        leaksOtherMember: false,
      },
    });
  });
});

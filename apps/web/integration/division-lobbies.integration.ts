import { daisyOrganizationId, scratchDatabase } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import {
  affirmativeSide,
  judgeSeat,
  negativeSide,
  sideSeat,
  type RoomView,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { everyoneReady } from './round-judging.test-support';
import {
  agreementWords,
  youthContentWaiverDocument,
  YOUTH_CONTENT_WAIVER_VERSION,
} from '../src/features/legal/agreements';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];

/**
 * Ages against the database's own clock (ADR 0147). Only the birth month is
 * known: a month 17 years 11 months back is under 18 all this month, and one
 * exactly 18 years back turns 18 this month, which counts as 18.
 */
const ages = {
  seventeen: '17 years 11 months',
  eighteen: '18 years',
  eighteenAndAHalf: '18 years 6 months',
  nineteenAndAMonth: '19 years 1 month',
  adult: '30 years',
} as const;
const setAge = (
  f: Fixture,
  member: Member,
  age: keyof typeof ages,
  recordedAgo = '1 second',
) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${ages[age]}::interval, 'YYYY-MM'), version = version + 1,
      recorded_at = now() - ${recordedAgo}::interval
    where user_id = ${member.userId}`;

/**
 * Daisy's two active seasons for the test, one per division. A Youth season
 * started `youthStartedAgo` back fixes who is Youth for it.
 */
const withSeasons = async (
  f: Fixture,
  run: () => Promise<void>,
  options: { readonly youth?: boolean; readonly youthStartedAgo?: string } = {},
) => {
  const seasons = [
    { id: createId(), division: 'open', ago: '1 day' },
    ...(options.youth === false
      ? []
      : [
          {
            id: createId(),
            division: 'youth',
            ago: options.youthStartedAgo ?? '1 day',
          },
        ]),
  ];
  for (const season of seasons)
    await f.sql`insert into seasons(organization_id,id,division,name,starts_at,status)
      values(${daisyOrganizationId},${season.id},${season.division},'Ladder fixture',now() - ${season.ago}::interval,'active')`;
  try {
    await run();
  } finally {
    for (const season of seasons) {
      await f.sql`delete from agreement_signatures where season_id=${season.id}`;
      await f.sql`delete from seasons where id=${season.id}`;
    }
  }
};

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'accepted',
    (error: unknown) => (isAppError(error) ? error.message : 'threw'),
  );

const ranked = async (f: Fixture) => {
  const [preset] =
    await f.sql`select format_version,version from format_presets where format_id='freestyle' and superseded_at is null`;
  return {
    resolution: { kind: 'strike' as const },
    selection: {
      kind: 'ranked' as const,
      formatId: 'freestyle' as const,
      formatVersion: preset!.format_version as number,
      presetVersion: preset!.version as number,
    },
  };
};

/** A ranked Room its host opens in their own lobby and sits in. */
const rankedRoomSetBy = async (f: Fixture, host: Member) => {
  const created = (await f.create(await ranked(f), host)).view;
  return (
    await f.command(host, created, {
      type: 'claim-seat',
      seat: sideSeat(affirmativeSide),
    })
  ).view;
};

const claim = (f: Fixture, member: Member, room: RoomView, judge = false) =>
  refusalOf(
    f.command(member, room, {
      type: 'claim-seat',
      seat: judge ? judgeSeat() : sideSeat(negativeSide),
    }),
  );

/** Makes `member` the owner of a school club: club staff (ADR 0151, ADR 0156). */
const makeClubStaff = async (f: Fixture, member: Member) => {
  const id = createId();
  await f.sql`insert into organizations(id,kind,name,handle,owner_user_id)
    values(${id},'school',${id},${id},${member.userId})`;
  return id;
};

test('a Room belongs to the lobby it is created in (ADR 0156)', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'seventeen');
      await setAge(f, f.guest, 'adult');
      await setAge(f, f.outsider, 'adult');
      const { id: youthLobby } = (
        await f.store.readOfficialStandingLobbies()
      ).find((lobby) => lobby.ageRule === 'under-18')!;
      const { id: openLobby } = (
        await f.store.readOfficialStandingLobbies()
      ).find((lobby) => lobby.ageRule === 'adults')!;
      const club = await makeClubStaff(f, f.outsider);
      try {
        const minorRanked = (await f.create(await ranked(f), f.host)).view;
        const minorCasual = (await f.create({}, f.host)).view;
        const adultCasual = (await f.create({}, f.guest)).view;
        const adultChoosesYouth = await refusalOf(
          f.create({ lobby: youthLobby }, f.guest),
        );
        const minorChoosesOpen = await refusalOf(
          f.create({ lobby: openLobby }, f.host),
        );
        const staffYouth = (
          await f.create(
            { ...(await ranked(f)), lobby: youthLobby },
            f.outsider,
          )
        ).view;
        const stored = await f.sql`select id, lobby_id from rooms
          where id in (${minorRanked.id}, ${minorCasual.id}, ${adultCasual.id}, ${staffYouth.id})`;
        const lobbyOf = (id: string) =>
          stored.find((row: { id: string }) => row.id === id)?.lobby_id;
        assert({
          given:
            'a 17-year-old creating ranked and casual Rooms, an adult creating casual and asking for Youth, the minor asking for Open, and club staff asking for Youth',
          should:
            'open each member’s Room in their own lobby, casual included, refuse the other lobby, and let club staff open a Youth Room',
          actual: {
            minorRanked: [minorRanked.lobbyId, lobbyOf(minorRanked.id)],
            minorCasual: minorCasual.lobbyId,
            adultCasual: adultCasual.lobbyId,
            adultChoosesYouth,
            minorChoosesOpen,
            staffYouth: lobbyOf(staffYouth.id),
          },
          expected: {
            minorRanked: [youthLobby, youthLobby],
            minorCasual: youthLobby,
            adultCasual: openLobby,
            adultChoosesYouth: 'other-division',
            minorChoosesOpen: 'other-division',
            staffYouth: youthLobby,
          },
        });
      } finally {
        await f.sql`delete from organizations where id=${club}`;
      }
    }),
  );
});

test('debater seats are for the Room’s own lobby; judges may be anyone', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'seventeen');
      await setAge(f, f.guest, 'adult');
      await setAge(f, f.outsider, 'seventeen');
      const youthRoom = await rankedRoomSetBy(f, f.host);
      const adultClaim = await claim(f, f.guest, youthRoom);
      const adultJudges = await claim(f, f.guest, youthRoom, true);
      const judged = await f.operations.view(f.host, youthRoom.id);
      const minorClaim = await claim(f, f.outsider, judged);
      // Fresh members: each holds one active Room at a time (ADR 0070).
      const adults = await f.freshCast();
      const minor = (await f.freshCast()).host;
      await setAge(f, adults.host, 'adult');
      await setAge(f, adults.guest, 'adult');
      await setAge(f, minor, 'seventeen');
      const openCasual = (await f.create({}, adults.host)).view;
      const minorCasualClaim = await refusalOf(
        f.command(minor, openCasual, {
          type: 'claim-seat',
          seat: sideSeat(affirmativeSide),
        }),
      );
      const openRanked = await rankedRoomSetBy(f, adults.guest);
      const minorRankedClaim = await claim(f, minor, openRanked);
      const minorJudgesOpen = await claim(f, minor, openRanked, true);
      assert({
        given:
          'a Youth ranked Room, then an Open casual and an Open ranked Room, each with members of both lobbies claiming seats',
        should:
          'refuse the adult’s Youth debater seat and the minor’s Open ones, ranked and casual, and seat each as judge',
        actual: {
          adultClaim,
          adultJudges,
          minorClaim,
          minorCasualClaim,
          minorRankedClaim,
          minorJudgesOpen,
        },
        expected: {
          adultClaim: 'other-division',
          adultJudges: 'accepted',
          minorClaim: 'accepted',
          minorCasualClaim: 'other-division',
          minorRankedClaim: 'other-division',
          minorJudgesOpen: 'accepted',
        },
      });
    }),
  );
});

test('a host cannot move a member of the other lobby onto a debater seat', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'adult');
      await setAge(f, f.guest, 'adult');
      await setAge(f, f.outsider, 'seventeen');
      // A seatless host, as a coach hosts (YRoomMixedHost).
      const created = (await f.create(await ranked(f), f.host)).view;
      const openRoom = (
        await f.command(f.guest, created, {
          type: 'claim-seat',
          seat: sideSeat(affirmativeSide),
        })
      ).view;
      await claim(f, f.outsider, openRoom, true);
      const judging = await f.operations.view(f.host, openRoom.id);
      const moved = await refusalOf(
        f.command(f.host, judging, {
          type: 'assign-seat',
          actorId: f.outsider.actorId,
          seat: sideSeat(negativeSide),
        }),
      );
      assert({
        given:
          'an Open ranked Room whose seatless host moves a minor from the judge seat onto a debater seat',
        should: 'refuse it: no Round mixes lobbies',
        actual: moved,
        expected: 'other-division',
      });
    }),
  );
});

test('a Youth Room rates on the Youth season, and starts ranked only while it is active', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'seventeen');
      await setAge(f, f.guest, 'seventeen');
      for (const member of [f.host, f.guest])
        await f.store.signContentWaiver({
          id: createId(),
          userId: member.userId,
          version: YOUTH_CONTENT_WAIVER_VERSION,
          words: agreementWords(youthContentWaiverDocument),
        });
      const signedOn = await f.sql`
        select s.division from agreement_signatures a join seasons s on s.id = a.season_id
         where a.user_id in (${f.host.userId}, ${f.guest.userId}) and a.agreement = 'ranked-content-waiver'`;
      let room = await rankedRoomSetBy(f, f.host);
      room = (
        await f.command(f.guest, room, {
          type: 'claim-seat',
          seat: sideSeat(negativeSide),
        })
      ).view;
      room = (
        await f.command(f.host, room, {
          type: 'assign-seat',
          seat: judgeSeat(),
          actorId: (await f.aiJudge()).actorId,
        })
      ).view;
      const ready = await everyoneReady(f, room, [f.host, f.guest]);
      // The Youth season ends between Ready and Start.
      await f.sql`update seasons set status='closed', ends_at=now() + interval '1 second'
        where division='youth' and status='active' and name='Ladder fixture'`;
      const started = await refusalOf(
        f.command(f.host, ready, { type: 'start-round' }),
      );
      const rounds =
        await f.sql`select count(*)::int as c from rounds where room_id=${room.id}`;
      assert({
        given:
          'two Youth debaters who signed the waiver, ready, whose Youth season then ends before Start',
        should:
          'sign them on the Youth season, refuse ranked at Start and launch no Round',
        actual: {
          signedOn: signedOn.map((row: { division: string }) => row.division),
          ageRule: room.ageRule,
          started,
          rounds: rounds[0]!.c,
        },
        expected: {
          signedOn: ['youth', 'youth'],
          ageRule: 'under-18',
          started: 'ranked-unavailable',
          rounds: 0,
        },
      });
    }),
  );
});

test('a member who turns 18 mid-season finishes it on Youth', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(
      f,
      async () => {
        // Eighteen this month, on record since before the Youth season
        // began, when they were still 17.
        await setAge(f, f.host, 'eighteen', '1 year');
        await setAge(f, f.guest, 'adult');
        const room = await rankedRoomSetBy(f, f.host);
        assert({
          given:
            'a member who turned 18 after the active Youth season began, sitting in a ranked Room, and an adult claiming beside them',
          should: 'seat them on Youth and refuse the adult',
          actual: {
            ageRule: room.ageRule,
            adultClaim: await claim(f, f.guest, room),
          },
          expected: { ageRule: 'under-18', adultClaim: 'other-division' },
        });
      },
      { youthStartedAgo: '3 months' },
    ),
  );
});

test('the Youth carry is bounded: no one is aged before their own record, nor more than a year back', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(
      f,
      async () => {
        // Signed up at 18 and a half, long after the Youth season began.
        await setAge(f, f.host, 'eighteenAndAHalf');
        // On record since before the season, 18 six months into it: carried.
        await setAge(f, f.guest, 'eighteenAndAHalf', '4 years');
        // On record since before the season, 19 and a month: past the carry.
        await setAge(f, f.outsider, 'nineteenAndAMonth', '4 years');
        const lateSignUp = (await rankedRoomSetBy(f, f.host)).ageRule;
        assert({
          given:
            'a Youth season begun three years ago, a member who recorded their age at 18 and a half, one on record since before it who is 18 and a half, and one who is 19 and a month',
          should:
            'put the late sign-up on Open, carry the 18-and-a-half on Youth, and put the 19-year-old on Open',
          actual: {
            lateSignUp,
            carried: (await rankedRoomSetBy(f, f.guest)).ageRule,
            pastTheCarry: (await rankedRoomSetBy(f, f.outsider)).ageRule,
          },
          expected: {
            lateSignUp: 'adults',
            carried: 'under-18',
            pastTheCarry: 'adults',
          },
        });
      },
      { youthStartedAgo: '3 years' },
    ),
  );
});

test('a Youth Room’s live Round has the same public audience as an Open one (ADR 0161)', async () => {
  await withRoomRuntime(async (f) => {
    // A fresh pair each: a member holds one active Room (ADR 0070).
    const liveRound = async (age: keyof typeof ages) => {
      const cast = await f.freshCast();
      await setAge(f, cast.host, age);
      await setAge(f, cast.guest, age);
      const room = await f.assemble({}, cast);
      const launched = await f.command(cast.host, room, {
        type: 'start-round',
      });
      return launched.view.roundRef!.id;
    };
    const watch = async (roundId: string) =>
      (await f.store.readSpectatorTimeline({
        roundId,
        horizonOf: () => 0,
      })) === null
        ? 'refused'
        : 'watching';
    const youth = await liveRound('seventeen');
    const youthWatch = await watch(youth);
    const open = await liveRound('adult');
    assert({
      given: 'a live casual Round in a Youth Room, then one in an Open Room',
      should: 'serve the spectator read of both alike',
      actual: { youth: youthWatch, open: await watch(open) },
      expected: { youth: 'watching', open: 'watching' },
    });
  });
});

test('Start refuses a seated debater who no longer fits the Room’s lobby', async () => {
  await withRoomRuntime(async (f) => {
    const cast = await f.freshCast();
    await setAge(f, cast.host, 'seventeen');
    await setAge(f, cast.guest, 'seventeen');
    const room = await f.assemble({}, cast);
    // The guest's division changes while seated: their age record is corrected.
    await setAge(f, cast.guest, 'adult');
    const started = await refusalOf(
      f.command(cast.host, room, { type: 'start-round' }),
    );
    const rounds =
      await f.sql`select count(*)::int as c from rounds where room_id=${room.id}`;
    assert({
      given: 'a Youth Room whose seated debater is now on record as an adult',
      should: 'refuse Start as the other lobby’s seat and launch no Round',
      actual: { started, rounds: rounds[0]!.c },
      expected: { started: 'other-division', rounds: 0 },
    });
  });
});

test('a ranked Start rechecks both a seatless host and a ready debater after a protection change', async () => {
  const scratch = scratchDatabase(databaseUrl, 'rankedprotection');
  await scratch.create();
  try {
    await scratch.migrate(() => true);
    await withRoomRuntime(
      async (f) =>
        withSeasons(f, async () => {
          const guardian = await f.member();
          // The extra member is an adult by default; seed their age with the
          // same durable fact used by the normal Room members.
          await f.sql`insert into account_age(user_id, birth_month, version, recorded_at)
          values (${guardian.userId}, to_char(now() - interval '30 years', 'YYYY-MM'), 1, now())
          on conflict (user_id) do nothing`;
          for (const member of [f.host, f.guest, f.outsider])
            await setAge(f, member, 'seventeen');
          for (const member of [f.host, f.guest]) {
            const evidence = createId();
            await f.sql`insert into guardian_consent_evidence(id, person_user_id, role, method,
            notice_kind, notice_version, notice_digest, recorded_at)
            values(${evidence}, ${guardian.userId}, 'guardian', 'created-account',
              'parental-consent', 'fixture', ${'a'.repeat(64)}, now())`;
            await f.sql`insert into guardian_links(id, guardian_user_id, minor_user_id,
            guardian_consent_id, status, activation, activated_at, created_at)
            values(${createId()}, ${guardian.userId}, ${member.userId}, ${evidence},
              'active', 'created-account', now(), now())`;
          }
          for (const member of [f.guest, f.outsider])
            await f.store.signContentWaiver({
              id: createId(),
              userId: member.userId,
              version: YOUTH_CONTENT_WAIVER_VERSION,
              words: agreementWords(youthContentWaiverDocument),
            });
          const protect = (member: Member, level: 'guided' | 'supervised') =>
            f.sql.begin(async (tx) => {
              await tx`select set_config('daisy.subject_scope', ${guardian.userId}, true)`;
              await tx`select public.daisy_set_protection_level(
              ${member.userId}, ${JSON.stringify({ level })}::text::jsonb)`;
            });
          let room = (await f.create(await ranked(f), f.host)).view;
          room = (
            await f.command(f.guest, room, {
              type: 'claim-seat',
              seat: sideSeat(affirmativeSide),
            })
          ).view;
          room = (
            await f.command(f.outsider, room, {
              type: 'claim-seat',
              seat: sideSeat(negativeSide),
            })
          ).view;
          room = (
            await f.command(f.host, room, {
              type: 'assign-seat',
              actorId: (await f.aiJudge()).actorId,
              seat: judgeSeat(),
            })
          ).view;
          const ready = await everyoneReady(f, room, [f.guest, f.outsider]);
          const start = () =>
            refusalOf(f.command(f.host, ready, { type: 'start-round' }));
          await protect(f.host, 'supervised');
          const hostRefusal = await start();
          await protect(f.host, 'guided');
          await protect(f.guest, 'supervised');
          const seatedRefusal = await start();
          const [before] =
            await f.sql`select count(*)::int as rounds from rounds where room_id=${room.id}`;
          await protect(f.guest, 'guided');
          const control = await start();
          assert({
            given:
              'an eligible Youth ranked Room with a ready cast and seatless host',
            should:
              'refuse Start for a Supervised host or debater without a Round, then allow Start on Guided',
            actual: {
              hostRefusal,
              seatedRefusal,
              rounds: before?.rounds,
              control,
            },
            expected: {
              hostRefusal: 'ranked-unavailable',
              seatedRefusal: 'ranked-unavailable',
              rounds: 0,
              control: 'accepted',
            },
          });
        }),
      { databaseUrl: scratch.url },
    );
  } finally {
    await scratch.drop();
  }
}, 60_000);

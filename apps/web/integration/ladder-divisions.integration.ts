import { daisyOrganizationId } from '@daisy/db/testing';
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
  contentWaiverDocument,
  CONTENT_WAIVER_VERSION,
} from '../src/features/legal/agreements';

setupRitewayBun();
requireTestServices(process.env);

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

/** A ranked Room whose host sits on the affirmative, setting its ladder. */
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

test('a ranked Room’s ladder follows who sits, and a member’s own seat must fit it', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'seventeen');
      await setAge(f, f.guest, 'eighteen');
      await setAge(f, f.outsider, 'seventeen');
      const unset = (await f.create(await ranked(f), f.host)).view;
      const youthRoom = await rankedRoomSetBy(f, f.host);
      const adultClaim = await claim(f, f.guest, youthRoom);
      const adultJudges = await claim(f, f.guest, youthRoom, true);
      const judged = await f.operations.view(f.host, youthRoom.id);
      const youthClaim = await claim(f, f.outsider, judged);
      const seated = await f.operations.view(f.host, youthRoom.id);
      assert({
        given:
          'a ranked Room a 17-year-old host opens and sits in, then an 18-year-old and another 17-year-old',
        should:
          'open it with no ladder, set Youth when the host sits, refuse the adult’s debater seat with the division reason, seat the adult as judge and the minor as debater',
        actual: {
          unset: unset.ladder,
          youth: youthRoom.ladder,
          adultClaim,
          adultJudges,
          youthClaim,
          seated: seated.ladder,
          debaterDivisions: seated.participants.flatMap((p) =>
            'actorId' in p && p.seat.kind === 'side' ? [p.division] : [],
          ),
        },
        expected: {
          unset: 'unset',
          youth: 'youth',
          adultClaim: 'ranked-division',
          adultJudges: 'accepted',
          youthClaim: 'accepted',
          seated: 'youth',
          debaterDivisions: ['youth', 'youth'],
        },
      });
    }),
  );
});

test('a minor takes no Open debater seat, and a host’s mixed seating starts a casual Round', async () => {
  await withRoomRuntime(async (f) =>
    withSeasons(f, async () => {
      await setAge(f, f.host, 'adult');
      await setAge(f, f.guest, 'adult');
      await setAge(f, f.outsider, 'seventeen');
      for (const member of [f.guest, f.outsider])
        await f.store.signContentWaiver({
          id: createId(),
          userId: member.userId,
          version: CONTENT_WAIVER_VERSION,
          words: agreementWords(contentWaiverDocument),
        });
      // A seatless host, as a coach hosts (YRoomMixedHost).
      const created = (await f.create(await ranked(f), f.host)).view;
      const openRoom = (
        await f.command(f.guest, created, {
          type: 'claim-seat',
          seat: sideSeat(affirmativeSide),
        })
      ).view;
      const minorClaim = await claim(f, f.outsider, openRoom);
      // Anyone may judge; the host then moves the minor onto the debate.
      const minorJudges = await claim(f, f.outsider, openRoom, true);
      const judging = await f.operations.view(f.host, openRoom.id);
      let mixed = (
        await f.command(f.host, judging, {
          type: 'assign-seat',
          actorId: f.outsider.actorId,
          seat: sideSeat(negativeSide),
        })
      ).view;
      mixed = (
        await f.command(f.host, mixed, {
          type: 'assign-seat',
          seat: judgeSeat(),
          actorId: (await f.aiJudge()).actorId,
        })
      ).view;
      const ready = await everyoneReady(f, mixed, [f.guest, f.outsider]);
      const started = await refusalOf(
        f.command(f.host, ready, { type: 'start-round' }),
      );
      const [round] = await f.sql`
        select competition_type, preset_version, ladder_id, ladder_division
          from rounds where room_id=${openRoom.id}`;
      assert({
        given:
          'an Open ranked Room an adult sits in, a minor claiming its debater seat, then the seatless host moving the minor from the judge seat onto it and starting',
        should:
          'refuse the minor’s own debater claim, seat them as judge, accept the host’s mixed seating, and start a casual Round that rates no one while the Room stays ranked',
        actual: {
          open: openRoom.ladder,
          minorClaim,
          minorJudges,
          mixed: mixed.ladder,
          room: mixed.competitionType,
          started,
          round,
        },
        expected: {
          open: 'open',
          minorClaim: 'ranked-division',
          minorJudges: 'accepted',
          mixed: 'mixed',
          room: 'ranked',
          started: 'accepted',
          round: {
            competition_type: 'casual',
            preset_version: null,
            ladder_id: null,
            ladder_division: null,
          },
        },
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
          version: CONTENT_WAIVER_VERSION,
          words: agreementWords(contentWaiverDocument),
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
          ladder: room.ladder,
          started,
          rounds: rounds[0]!.c,
        },
        expected: {
          signedOn: ['youth', 'youth'],
          ladder: 'youth',
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
            ladder: room.ladder,
            adultClaim: await claim(f, f.guest, room),
          },
          expected: { ladder: 'youth', adultClaim: 'ranked-division' },
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
        const lateSignUp = (await rankedRoomSetBy(f, f.host)).ladder;
        assert({
          given:
            'a Youth season begun three years ago, a member who recorded their age at 18 and a half, one on record since before it who is 18 and a half, and one who is 19 and a month',
          should:
            'put the late sign-up on Open, carry the 18-and-a-half on Youth, and put the 19-year-old on Open',
          actual: {
            lateSignUp,
            carried: (await rankedRoomSetBy(f, f.guest)).ladder,
            pastTheCarry: (await rankedRoomSetBy(f, f.outsider)).ladder,
          },
          expected: {
            lateSignUp: 'open',
            carried: 'youth',
            pastTheCarry: 'open',
          },
        });
      },
      { youthStartedAgo: '3 years' },
    ),
  );
});

test('a casual Room seats any member, whatever their division', async () => {
  await withRoomRuntime(async (f) => {
    await setAge(f, f.guest, 'seventeen');
    await setAge(f, f.host, 'adult');
    const room = await f.assemble();
    assert({
      given: 'a casual Room with an adult and a 17-year-old debater',
      should: 'seat and ready them both, with no ladder',
      actual: {
        ladder: room.ladder,
        ready: room.participants.filter(
          (p) => 'actorId' in p && p.ready === 'ready',
        ).length,
      },
      expected: { ladder: null, ready: 2 },
    });
  });
});

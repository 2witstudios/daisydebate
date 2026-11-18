import { daisyOrganizationId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { judgeSeat, negativeSide, sideSeat } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { readyRankedRoom } from './ranked-room.test-support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];

/**
 * Decision 79 against the database's own clock: a birth month 17 years 11
 * months back is under 18 for this whole month, and one exactly 18 years back
 * turns 18 this month, which counts as 18 (only the month is known).
 */
const ages = {
  seventeenElevenMonths: '17 years 11 months',
  exactlyEighteen: '18 years',
} as const;
const setAge = (f: Fixture, member: Member, age: keyof typeof ages) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${ages[age]}::interval, 'YYYY-MM'), version = version + 1
    where user_id = ${member.userId}`;

const withSeason = async (f: Fixture, run: () => Promise<void>) => {
  const seasonId = createId();
  await f.sql`insert into seasons(organization_id,id,name,starts_at,status) values(${daisyOrganizationId},${seasonId},'Ranked age fixture','2000-01-01T00:00:00Z','active')`;
  try {
    await run();
  } finally {
    await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
  }
};

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'accepted',
    (error: unknown) => (isAppError(error) ? error.message : 'threw'),
  );

const rankedSelection = async (f: Fixture) => {
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

test('opening a ranked Room needs the host at 18 on the day', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const ranked = await rankedSelection(f);
      await setAge(f, f.host, 'seventeenElevenMonths');
      const under = await refusalOf(f.create(ranked));
      const casual = await refusalOf(f.create({}));
      const host = await f.member();
      await setAge(f, host, 'exactlyEighteen');
      const eighteen = await refusalOf(f.create(ranked, host));
      assert({
        given:
          'a ranked create from a host aged 17 years 11 months, their casual create, then one from a host turning 18 this month',
        should:
          'refuse the ranked one on age, and accept the casual and the 18',
        actual: { under, casual, eighteen },
        expected: {
          under: 'ranked-age',
          casual: 'accepted',
          eighteen: 'accepted',
        },
      });
    }),
  );
});

test('taking a seat in a ranked Room needs 18, and a host naming someone under it hears no age', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = (await f.create(await rankedSelection(f))).view;
      await setAge(f, f.guest, 'seventeenElevenMonths');
      await setAge(f, f.outsider, 'seventeenElevenMonths');
      const claimed = await refusalOf(
        f.command(f.guest, room, {
          type: 'claim-seat',
          seat: sideSeat(negativeSide),
        }),
      );
      const judging = await refusalOf(
        f.command(f.outsider, room, { type: 'claim-seat', seat: judgeSeat() }),
      );
      const assigned = await refusalOf(
        f.command(f.host, room, {
          type: 'assign-seat',
          actorId: f.guest.actorId,
          seat: sideSeat(negativeSide),
        }),
      );
      const seats =
        await f.sql`select count(*)::int as c from room_participants where room_id=${room.id}`;
      await setAge(f, f.guest, 'exactlyEighteen');
      const eighteen = await refusalOf(
        f.command(f.guest, room, {
          type: 'claim-seat',
          seat: sideSeat(negativeSide),
        }),
      );
      assert({
        given:
          'a 17y11m member claiming a side and the judge seat, the host assigning one, then the member at 18',
        should:
          'refuse their own claims on age, the host’s assignment without naming age, seat nobody, then seat them at 18',
        actual: { claimed, judging, assigned, seats: seats[0]!.c, eighteen },
        expected: {
          claimed: 'ranked-age',
          judging: 'ranked-age',
          assigned: 'actor-ineligible',
          seats: 0,
          eighteen: 'accepted',
        },
      });
    }),
  );
});

test('Start reads every seat’s age on the Round’s own date', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await readyRankedRoom(f, 'freestyle', 'ai');
      // A seat taken at 18 whose stored month then says 17: Start decides on it.
      await setAge(f, f.guest, 'seventeenElevenMonths');
      const view = await f.operations.view(f.host, room.id);
      const readied = await refusalOf(f.consent(f.guest, view, 'unready'));
      const again = await f.operations.view(f.guest, room.id);
      const ready = await refusalOf(f.consent(f.guest, again, 'ready'));
      const shown = (await f.operations.view(f.outsider, room.id)).participants
        .filter((p) => 'actorId' in p && p.actorId === f.guest.actorId)
        .map((p) => p.eligible);
      const started = await refusalOf(
        f.command(f.host, view, { type: 'start-round' }),
      );
      const rounds =
        await f.sql`select count(*)::int as c from rounds where room_id=${room.id}`;
      assert({
        given:
          'a ranked Room one of whose debaters is under 18 on the day: their Ready, the roster, then Start',
        should:
          'tell them their own age at Ready, show nobody which seat it is, and refuse Start without naming whose age',
        actual: { readied, ready, shown, started, rounds: rounds[0]!.c },
        expected: {
          readied: 'accepted',
          ready: 'ranked-age',
          shown: [true],
          started: 'actor-ineligible',
          rounds: 0,
        },
      });
    }),
  );
});

test('a casual Room stays open to members 16 and 17', async () => {
  await withRoomRuntime(async (f) => {
    await setAge(f, f.guest, 'seventeenElevenMonths');
    const room = await f.assemble();
    assert({
      given: 'a casual Room with a 17y11m debater',
      should: 'seat and ready them as before',
      actual: room.participants.some(
        (p) =>
          'actorId' in p &&
          p.actorId === f.guest.actorId &&
          p.ready === 'ready',
      ),
      expected: true,
    });
  });
});

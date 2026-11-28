import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { isJudgeSeat } from '@daisy/protocol/seats';
import {
  oneOnOneCast,
  oneOnOneSeats,
  runtimeWorld,
} from './runtime.test-support';
import { speakingParticipants } from './round-speaking';
import {
  teamActors,
  teamRules,
  teamSeatIds,
  teamSeats,
  teamWorld,
} from './team-round.test-support';
setupRitewayBun();
const { at, person, rules } = oneOnOneCast();

test('a speech is its speaker’s, joined only by an accepted point’s holder', () => {
  const team = teamRules();
  const seats = teamSeats();
  assert({
    given: 'a speech with no point, then with the first negative’s point',
    should: 'grant the speaker, then the speaker and the holder',
    actual: [
      speakingParticipants(team, seats, 0, null),
      speakingParticipants(team, seats, 0, teamSeatIds.neg1),
    ],
    expected: [[teamSeatIds.aff1], [teamSeatIds.aff1, teamSeatIds.neg1]],
  });
});

test('a seat that left never speaks again (INTX-12)', () => {
  const team = teamRules();
  assert({
    given: 'cross-examination after the first negative left',
    should: 'grant every other debater and never the judge',
    actual: speakingParticipants(team, teamSeats(), 2, null, [
      teamSeatIds.neg1,
    ]),
    expected: [teamSeatIds.aff1, teamSeatIds.aff2, teamSeatIds.neg2],
  });
});

test('cross-examination keeps both microphones open and takes no points of information', async () => {
  const world = runtimeWorld();
  world.activate({ at: at(0), now: at(0) });
  const opened = world.tick(at(330_000));
  const cx = opened.segmentInserts.find((s) => s.type === 'cross_ex')!;
  const grant = opened.speakingChanges?.find(
    (s) => s.kind === 'open' && s.segmentId === cx.id,
  );
  assert({
    given: 'cross-examination opened by the clock',
    should: 'grant both debaters and not the judge',
    actual: grant?.kind === 'open' ? grant.participantIds : [],
    expected: oneOnOneSeats
      .filter((seat) => !isJudgeSeat(seat.seat))
      .map((seat) => seat.id),
  });
  const before = world.position(at(331_000));
  await assertRejects({
    given: 'a point of information offered during cross-examination',
    should: 'refuse with the POI-rule invariant',
    actual: () =>
      world.execute({
        command: { type: 'offer_poi', sequence: 1 },
        actorId: person,
        now: at(331_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.poi.requires-rule',
  });
  await assertRejects({
    given: 'the respondent ending the questioner’s cross-examination',
    should: 'refuse: speaking is not asking',
    actual: () =>
      world.execute({
        command: { type: 'yield', sequence: 1 },
        actorId: person,
        now: at(331_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.yield.requires-floor',
  });
  assert({
    given: 'refused commands',
    should: 'preserve engine position',
    actual: world.position(at(331_000)),
    expected: before,
  });
  assert({
    given: 'the rules the world ran under',
    should: 'be the one-on-one rules',
    actual: rules.segments[1]?.type,
    expected: 'cross_ex',
  });
});

test('a leave in the step that opened a segment still records the leaver’s grant up to the leave (INTX-12)', () => {
  const world = teamWorld({
    rules: teamRules({ outcome: { kind: 'ranking', of: 'sides' } }),
  });
  world.activate({ at: at(0), now: at(0) });
  world.tick(at(860_000));
  // CX opens at 870 s; the second negative's leave at 900 s is the first word since.
  const left = world.execute({
    command: { type: 'leave' },
    actorId: teamActors.neg2,
    now: at(900_000),
  });
  const opens = (left.speakingChanges ?? []).filter(
    (change) => change.kind === 'open',
  );
  assert({
    given:
      'cross-examination opened by the catch-up of a step whose command is a leave',
    should:
      'open cross-examination with every debater, the leaver included, and reopen it without the leaver at the leave',
    actual: opens.map((change) =>
      change.kind === 'open' ? [change.at, change.participantIds] : [],
    ),
    expected: [
      [
        at(870_000),
        [
          teamSeatIds.aff1,
          teamSeatIds.aff2,
          teamSeatIds.neg1,
          teamSeatIds.neg2,
        ],
      ],
      [at(900_000), [teamSeatIds.aff1, teamSeatIds.aff2, teamSeatIds.neg1]],
    ],
  });
});

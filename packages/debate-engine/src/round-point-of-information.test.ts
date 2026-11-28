import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundAt as at } from './runtime.test-support';
import {
  teamActors,
  teamRules,
  teamSeatIds,
  teamSeats,
  teamWorld,
} from './team-round.test-support';
import { mediaGrants } from './media-grants';

setupRitewayBun();

// The team Round: 1A (affirmative slot 0) speaks 10s–430s. Its offers open at
// 70s (60 s protected start) and close at 370s (60 s protected end).
const firstSpeech = 0;
const speaking = () => {
  const world = teamWorld();
  world.activate({ at: at(0), now: at(0) });
  world.tick(at(100_000));
  return world;
};
const offer = (
  world: ReturnType<typeof teamWorld>,
  actorId: string,
  ms: number,
) =>
  world.execute({
    command: { type: 'offer_poi', sequence: firstSpeech },
    actorId,
    now: at(ms),
  });

describe('points of information', () => {
  test('only a person on the other side offers, and only in unprotected time (INTX-13)', async () => {
    const world = teamWorld();
    world.activate({ at: at(0), now: at(0) });
    await assertRejects({
      given: 'an offer 30 s into the speech',
      should: 'refuse inside the protected start',
      actual: () => offer(world, teamActors.neg1, 40_000),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'the speaker’s own partner offering',
      should: 'refuse: only the other side offers',
      actual: () => offer(world, teamActors.aff2, 100_000),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'an offer once the final minute has begun',
      should: 'refuse inside the protected end',
      actual: () => {
        const late = speaking();
        late.tick(at(380_000));
        return offer(late, teamActors.neg1, 380_000);
      },
      code: 'CONFLICT',
    });
    const offered = offer(world, teamActors.neg1, 100_000);
    assert({
      given: 'the first negative offering in unprotected time',
      should: 'stand one offer with its instant',
      actual: offered.round?.checkpoint.point_of_information,
      expected: {
        phase: 'offered',
        offers: [{ participant_id: teamSeatIds.neg1, offered_at: at(100_000) }],
      },
    });
    await assertRejects({
      given: 'the same seat offering twice',
      should: 'refuse',
      actual: () => offer(world, teamActors.neg1, 101_000),
      code: 'CONFLICT',
    });
  });

  test('an offer lapses at its exact instant, and at the protected end (INTX-13)', () => {
    const world = speaking();
    offer(world, teamActors.neg1, 100_000);
    offer(world, teamActors.neg2, 105_000);
    const first = world.tick(at(110_500));
    assert({
      given: 'a tick just after the first offer’s 10 s lapse',
      should: 'sit the first offer down and keep the second',
      actual: first.round?.checkpoint.point_of_information,
      expected: {
        phase: 'offered',
        offers: [{ participant_id: teamSeatIds.neg2, offered_at: at(105_000) }],
      },
    });
    const late = speaking();
    offer(late, teamActors.neg1, 365_000);
    assert({
      given: 'an offer 5 s before the protected end, read later',
      should: 'lapse at the protected end, not after its own 10 s',
      actual: late.position(at(366_000)).pointOfInformation?.offers,
      expected: [{ participantId: teamSeatIds.neg1, lapsesAt: at(370_000) }],
    });
    assert({
      given: 'the position after the protected end',
      should: 'show nobody standing',
      actual: late.position(at(370_000)).pointOfInformation?.offers,
      expected: [],
    });
  });

  test('the speaker accepts one offer or declines all (INTX-14)', async () => {
    const world = speaking();
    offer(world, teamActors.neg1, 100_000);
    offer(world, teamActors.neg2, 101_000);
    await assertRejects({
      given: 'someone other than the speaker accepting',
      should: 'refuse',
      actual: () =>
        world.execute({
          command: {
            type: 'accept_poi',
            sequence: firstSpeech,
            offererParticipantId: teamSeatIds.neg1,
          },
          actorId: teamActors.aff2,
          now: at(102_000),
        }),
      code: 'CONFLICT',
    });
    const accepted = world.execute({
      command: {
        type: 'accept_poi',
        sequence: firstSpeech,
        offererParticipantId: teamSeatIds.neg2,
      },
      actorId: teamActors.aff1,
      now: at(102_000),
    });
    const segmentId = 'segment-1';
    assert({
      given: 'the speaker taking the second negative’s offer',
      should:
        'give that seat the point, sit the other down and open both microphones',
      actual: {
        point: accepted.round?.checkpoint.point_of_information,
        speaking: accepted.speakingChanges,
        clock: world.position(at(102_000)).openSegment?.remainingMs,
      },
      expected: {
        point: {
          phase: 'speaking',
          holder_participant_id: teamSeatIds.neg2,
          accepted_at: at(102_000),
        },
        speaking: [
          { kind: 'close', segmentId, at: at(102_000) },
          {
            kind: 'open',
            segmentId,
            at: at(102_000),
            participantIds: [teamSeatIds.aff1, teamSeatIds.neg2],
          },
        ],
        clock: 328_000,
      },
    });
    const declined = speaking();
    offer(declined, teamActors.neg1, 100_000);
    offer(declined, teamActors.neg2, 101_000);
    assert({
      given: 'the speaker declining',
      should: 'sit every offer down',
      actual: declined.execute({
        command: { type: 'decline_poi', sequence: firstSpeech },
        actorId: teamActors.aff1,
        now: at(102_000),
      }).round?.checkpoint.point_of_information,
      expected: { phase: 'none' },
    });
  });

  test('accepting a withdrawn or lapsed offer is refused (INTX-14)', async () => {
    const withdrawn = speaking();
    offer(withdrawn, teamActors.neg1, 100_000);
    withdrawn.execute({
      command: { type: 'withdraw_poi', sequence: firstSpeech },
      actorId: teamActors.neg1,
      now: at(101_000),
    });
    const accept = (world: ReturnType<typeof teamWorld>, ms: number) => () =>
      world.execute({
        command: {
          type: 'accept_poi',
          sequence: firstSpeech,
          offererParticipantId: teamSeatIds.neg1,
        },
        actorId: teamActors.aff1,
        now: at(ms),
      });
    await assertRejects({
      given: 'acceptance racing a withdrawal that landed first',
      should: 'refuse: the offer no longer stands',
      actual: accept(withdrawn, 101_500),
      code: 'CONFLICT',
    });
    const lapsed = speaking();
    offer(lapsed, teamActors.neg1, 100_000);
    await assertRejects({
      given:
        'acceptance arriving after the offer’s lapse, with no tick between',
      should: 'refuse: the clock sits the offer down first',
      actual: accept(lapsed, 110_000),
      code: 'CONFLICT',
    });
  });

  test('an accepted point returns the speech at exactly its limit, or sooner (INTX-15)', () => {
    const world = speaking();
    offer(world, teamActors.neg1, 100_000);
    world.execute({
      command: {
        type: 'accept_poi',
        sequence: firstSpeech,
        offererParticipantId: teamSeatIds.neg1,
      },
      actorId: teamActors.aff1,
      now: at(101_000),
    });
    assert({
      given: 'the position during the point',
      should: 'count down the 15 s limit',
      actual: world.position(at(106_000)).pointOfInformation?.holder,
      expected: {
        participantId: teamSeatIds.neg1,
        endsAt: at(116_000),
        remainingMs: 10_000,
      },
    });
    const returned = world.tick(at(130_000));
    assert({
      given: 'a late tick after the limit',
      should: 'return the speech at the limit’s exact instant',
      actual: {
        point: returned.round?.checkpoint.point_of_information,
        speaking: returned.speakingChanges,
      },
      expected: {
        point: { phase: 'none' },
        speaking: [
          { kind: 'close', segmentId: 'segment-1', at: at(116_000) },
          {
            kind: 'open',
            segmentId: 'segment-1',
            at: at(116_000),
            participantIds: [teamSeatIds.aff1],
          },
        ],
      },
    });
    const resumed = speaking();
    offer(resumed, teamActors.neg1, 100_000);
    resumed.execute({
      command: {
        type: 'accept_poi',
        sequence: firstSpeech,
        offererParticipantId: teamSeatIds.neg1,
      },
      actorId: teamActors.aff1,
      now: at(101_000),
    });
    assert({
      given: 'the speaker resuming 5 s in',
      should: 'end the point at once',
      actual: resumed.execute({
        command: { type: 'end_poi', sequence: firstSpeech },
        actorId: teamActors.aff1,
        now: at(106_000),
      }).round?.checkpoint.point_of_information,
      expected: { phase: 'none' },
    });
  });

  test('a point survives nothing past its speech, nor a stale press (INTX-7)', async () => {
    const world = speaking();
    offer(world, teamActors.neg1, 100_000);
    world.tick(at(440_000)); // 1A has ended; 1N is live
    await assertRejects({
      given: 'acceptance meant for the 1A arriving in the 1N',
      should: 'refuse as stale',
      actual: () =>
        world.execute({
          command: {
            type: 'accept_poi',
            sequence: firstSpeech,
            offererParticipantId: teamSeatIds.neg1,
          },
          actorId: teamActors.aff1,
          now: at(450_000),
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the checkpoint after the speech closed',
      should: 'hold no point of information',
      actual: world.checkpoint().point_of_information,
      expected: { phase: 'none' },
    });
  });

  test('cross-examination takes no points of information', async () => {
    const world = teamWorld();
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(950_000));
    await assertRejects({
      given: 'an offer during cross-examination',
      should: 'refuse with the POI-rule invariant',
      actual: () =>
        world.execute({
          command: { type: 'offer_poi', sequence: 2 },
          actorId: teamActors.neg1,
          now: at(950_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.poi.requires-rule',
    });
  });

  test('no one offers to a bot speaker, and a bot never offers (INTX-17)', async () => {
    const botSpeaker = teamWorld({ bots: ['aff1'] });
    botSpeaker.activate({ at: at(0), now: at(0) });
    await assertRejects({
      given: 'an offer to a bot’s speech',
      should: 'refuse',
      actual: () => offer(botSpeaker, teamActors.neg1, 100_000),
      code: 'CONFLICT',
    });
    const botOpponent = teamWorld({ bots: ['neg1'] });
    botOpponent.activate({ at: at(0), now: at(0) });
    await assertRejects({
      given: 'a bot seat offering',
      should: 'refuse',
      actual: () => offer(botOpponent, teamActors.neg1, 100_000),
      code: 'CONFLICT',
    });
  });

  test('a holder who leaves gives the speech back, and an offerer who leaves sits down (INTX-12)', () => {
    const rules = teamRules({ outcome: { kind: 'ranking', of: 'sides' } });
    const world = teamWorld({ rules });
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(100_000));
    offer(world, teamActors.neg1, 100_000);
    offer(world, teamActors.neg2, 100_500);
    world.execute({
      command: {
        type: 'accept_poi',
        sequence: firstSpeech,
        offererParticipantId: teamSeatIds.neg1,
      },
      actorId: teamActors.aff1,
      now: at(101_000),
    });
    const left = world.execute({
      command: { type: 'leave' },
      actorId: teamActors.neg1,
      now: at(103_000),
    });
    assert({
      given: 'the holder leaving mid-point',
      should: 'end the point and leave the speaker alone on the floor',
      actual: {
        point: left.round?.checkpoint.point_of_information,
        speaking: left.speakingChanges?.at(-1),
      },
      expected: {
        point: { phase: 'none' },
        speaking: {
          kind: 'open',
          segmentId: 'segment-1',
          at: at(103_000),
          participantIds: [teamSeatIds.aff1],
        },
      },
    });
  });

  test('a speaker who leaves takes the offers down, and a listener who leaves splits no interval', async () => {
    const rules = teamRules({ outcome: { kind: 'ranking', of: 'sides' } });
    const world = teamWorld({ rules });
    world.activate({ at: at(0), now: at(0) });
    world.tick(at(100_000));
    offer(world, teamActors.neg1, 100_000);
    const listenerLeft = world.execute({
      command: { type: 'leave' },
      actorId: teamActors.aff2,
      now: at(100_500),
    });
    const speakerLeft = world.execute({
      command: { type: 'leave' },
      actorId: teamActors.aff1,
      now: at(101_000),
    });
    assert({
      given:
        'the speaker’s partner leaving, then the speaker, while the first negative offers',
      should:
        'record no speakers change for the partner, who was not speaking, and take the offer down with the speaker',
      actual: {
        listener: listenerLeft.speakingChanges ?? [],
        point: speakerLeft.round?.checkpoint.point_of_information,
      },
      expected: { listener: [], point: { phase: 'none' } },
    });
    await assertRejects({
      given: 'the second negative offering to the speaker who has left',
      should: 'refuse it: nobody can accept',
      actual: () => offer(world, teamActors.neg2, 102_000),
      code: 'CONFLICT',
    });
  });

  test('during a point both the speaker and the holder are granted a microphone', () => {
    const world = speaking();
    offer(world, teamActors.neg1, 100_000);
    world.execute({
      command: {
        type: 'accept_poi',
        sequence: firstSpeech,
        offererParticipantId: teamSeatIds.neg1,
      },
      actorId: teamActors.aff1,
      now: at(101_000),
    });
    const microphone = (participantId: string, ms: number) =>
      mediaGrants({
        participants: teamSeats().map((seat) => ({ ...seat, eligible: true })),
        participantId,
        rules: teamRules(),
        position: world.position(at(ms)),
        now: at(ms),
        finalSegmentEndedAt: null,
        inPreRoundPrep: false,
      }).publish.includes('microphone');
    assert({
      given: 'the point being given, then after its limit',
      should: 'grant the holder a microphone only while it holds the point',
      actual: {
        during: [teamSeatIds.aff1, teamSeatIds.neg1, teamSeatIds.neg2].map(
          (id) => microphone(id, 105_000),
        ),
        after: microphone(teamSeatIds.neg1, 117_000),
      },
      expected: { during: [true, true, false], after: false },
    });
  });
});

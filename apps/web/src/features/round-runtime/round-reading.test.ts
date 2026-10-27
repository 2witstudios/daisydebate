import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  floorSideOf,
  initialsOf,
  isLiveRound,
  isSeat,
  judgeKindOf,
  sideName,
} from './round-reading';
import { spectatorViewOf } from '../spectating/spectator-view';
import { liveRoundOf } from '../../ui/debate-room/live-round';
import {
  neg,
  view,
  ran,
  at,
  startOf,
} from '../../ui/debate-room/live-round.test-support';

setupRitewayBun();

test('one reading of sides, seats, liveness and judge (ISSUE-672)', () => {
  assert({
    given: 'the shared round reading',
    should:
      'name the sides, tell seats from the judge, treat scheduled and active as live, read the judge kind and initial a name',
    actual: [
      sideName,
      view.participants.map(isSeat),
      (['scheduled', 'active', 'completed', 'abandoned'] as const).map(
        (status) => isLiveRound({ ...view, status }),
      ),
      judgeKindOf(view),
      judgeKindOf({
        ...view,
        participants: view.participants.filter((p) => p.role !== 'judge'),
      }),
      [initialsOf('Ada  Lovelace Byron'), initialsOf('ada'), initialsOf('')],
    ],
    expected: [
      { affirmative: 'Affirmative', negative: 'Negative' },
      view.participants.map((p) => p.role !== 'judge'),
      [true, true, false, false],
      'human',
      null,
      ['AL', 'A', ''],
    ],
  });
});

test('an accepted interruption gives the floor to the interrupter for spectators and debaters alike (ISSUE-672, ISSUE-673)', () => {
  const speaking = ran(1);
  const nowMs = Date.parse(at(startOf(0) + 1000));
  // The negative's interruption, accepted half a second into the speech.
  const open = {
    ...speaking,
    checkpoint: {
      ...speaking.checkpoint!,
      floor: {
        holder_participant_id: neg.id,
        granted_at: at(startOf(0) + 500),
      },
    },
  };
  const segment = { side: 'affirmative' as const, floorParticipantId: neg.id };
  const spectator = spectatorViewOf(open, nowMs);
  const debater = liveRoundOf(open, neg.actorId, nowMs);
  assert({
    given: "the affirmative's speech with the negative's interruption accepted",
    should:
      'hand the floor to the negative in the shared reading, show the negative speaking to a spectator and to the negative debater',
    actual: [
      floorSideOf(open, segment),
      spectator.seats.map(({ side, activity }) => [side, activity]),
      debater?.phase,
    ],
    expected: [
      'negative',
      [
        ['affirmative', 'listening'],
        ['negative', 'speaking'],
      ],
      'own-speech',
    ],
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundHoldsMembers } from './room-membership';
import {
  oneOnOneActors,
  oneOnOneRules,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();

test('a Round holds its Room members only while scheduled or speaking (ADR 0070)', () => {
  assert({
    given:
      'scheduled, speaking, awaiting-ballot, completed and abandoned Rounds',
    should: 'hold members only before the last speech ends',
    actual: [
      roundHoldsMembers({ status: 'scheduled', debateEnded: false }),
      roundHoldsMembers({ status: 'active', debateEnded: false }),
      roundHoldsMembers({ status: 'active', debateEnded: true }),
      roundHoldsMembers({ status: 'completed', debateEnded: true }),
      roundHoldsMembers({ status: 'abandoned', debateEnded: false }),
    ],
    expected: [true, true, false, false, false],
  });
});

test('the runtime rules the release in the revision that ends the debate', () => {
  const rules = oneOnOneRules();
  const totalMs =
    rules.segments.length * rules.countdownMs +
    rules.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
  const played = runtimeWorld();
  const started = played.execute({
    command: { type: 'start' },
    actorId: null,
    now: roundAt(0),
  });
  const speaking = played.tick(roundAt(rules.countdownMs + 1_000));
  const ended = played.tick(roundAt(totalMs));
  const forfeited = runtimeWorld().execute({
    command: { type: 'forfeit' },
    actorId: oneOnOneActors.affirmative,
    now: roundAt(0),
  });
  assert({
    given:
      'a Round started, speaking, past its final speech, and a scheduled Round forfeited',
    should:
      'keep members while it plays and release them once it is over or abandoned',
    actual: [
      started.releasesRoomMembers,
      speaking.releasesRoomMembers,
      [ended.round?.status, ended.releasesRoomMembers],
      [forfeited.round?.status, forfeited.releasesRoomMembers],
    ],
    expected: [undefined, undefined, ['active', true], ['abandoned', true]],
  });
});

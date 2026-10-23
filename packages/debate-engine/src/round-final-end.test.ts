import { assert, setupRitewayBun, test } from 'riteway/bun';
import { practiceCast, runtimeWorld } from './runtime.test-support';
setupRitewayBun();
const { rules, at, person } = practiceCast();
const total = rules.segments.reduce(
  (n, s) => n + s.durationMs + rules.countdownMs,
  0,
);
test('the final actual segment closes at its own elapsed deadline while Round awaits judging', () => {
  const world = runtimeWorld();
  world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
  const projection = world.tick(at(total + 120_000));
  assert({
    given: 'a late tick after the actual final deadline',
    should:
      'persist exact final end and leave competitive completion for judging',
    actual: {
      final: projection.finalSegmentEndedAt,
      close: projection.segmentCloses.at(-1)?.endedAt,
      status: projection.round?.status,
      awaiting: world.position(at(total + 120_000)).awaitingBallot,
      open: world.position(at(total + 120_000)).openSegment,
    },
    expected: {
      final: at(total),
      close: at(total),
      status: 'active',
      awaiting: true,
      open: null,
    },
  });
  assert({
    given: 'the deadline was already projected',
    should: 'not rewrite its immutable anchor on the next tick',
    actual: world.tick(at(total + 240_000)).finalSegmentEndedAt,
    expected: undefined,
  });
});
test('accepted early final yield anchors actual end independently of the original timetable', () => {
  const world = runtimeWorld();
  world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
  const early = total - 1000;
  world.tick(at(early));
  const ended = world.execute({
    command: { type: 'yield' },
    actorId: person,
    now: at(early),
  });
  assert({
    given: 'the final floor holder yields before the segment duration ends',
    should: 'anchor the early close without completing the Round',
    actual: {
      final: ended.finalSegmentEndedAt,
      status: ended.round?.status,
      awaiting: world.position(at(early)).awaitingBallot,
    },
    expected: { final: at(early), status: 'active', awaiting: true },
  });
});

test('scheduled abandonment invents no played interval or capture anchor', () => {
  const abandoned = runtimeWorld().execute({
    command: { type: 'forfeit' },
    actorId: person,
    now: at(0),
  });
  assert({
    given: 'forfeit before any segment is played',
    should: 'abandon without a fabricated capture deadline',
    actual: {
      status: abandoned.round?.status,
      anchor: abandoned.finalSegmentEndedAt,
      speaking: abandoned.speakingChanges,
    },
    expected: { status: 'abandoned', anchor: undefined, speaking: [] },
  });
});

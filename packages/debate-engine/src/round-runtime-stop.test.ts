import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { oneOnOneCast, runtimeWorld } from './runtime.test-support';
setupRitewayBun();
const { at, person } = oneOnOneCast();

test('ordinary internal stop closes actual play and abandons without inventing a result or incident', () => {
  const world = runtimeWorld();
  world.activate({ at: at(0), now: at(0) });
  world.tick(at(10_000));
  const stopped = world.stop(at(12_000));
  assert({
    given: 'a live ordinary speech stopped by its authorized owner',
    should:
      'close the actual interval and preserve the ordinary terminal projection',
    actual: {
      round: stopped.round,
      closes: stopped.segmentCloses,
      finalPlayedEnd: stopped.finalSegmentEndedAt,
      incidents: stopped.incidentChanges ?? [],
      newSegments: stopped.segmentInserts,
    },
    expected: {
      round: {
        status: 'abandoned',
        currentStage: null,
        startedAt: at(0),
        completedAt: at(12_000),
        outcome: null,
        checkpoint: world.checkpoint(),
      },
      closes: [{ id: 'segment-1', endedAt: at(12_000) }],
      finalPlayedEnd: at(12_000),
      incidents: [],
      newSegments: [],
    },
  });
});

test('source invalidation never rewrites a completed historical Round', async () => {
  const world = runtimeWorld();
  world.activate({ at: at(0), now: at(0) });
  world.execute({
    command: { type: 'forfeit' },
    actorId: person,
    now: at(10_000),
  });
  const before = world.position(at(11_000));
  await assertRejects({
    given: 'a completed ordinary Round with its actual forfeit',
    should: 'refuse applying live-stop to the retained historical ending',
    actual: () => world.stop(at(12_000)),
    code: 'INVARIANT',
    invariantId: 'round.lifecycle.matches-status',
  });
  assert({
    given: 'that refused stop',
    should: 'preserve the exact historical position',
    actual: world.position(at(11_000)),
    expected: before,
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

/**
 * A judge still holding a microphone and a debater not yet opened, with
 * every media-session read journaled beside the vendor writes.
 */
const floorChange = async () => {
  const world = createMediaWorld();
  const read = world.input.store.readMediaSession;
  world.input.store.readMediaSession = (async (
    ...args: Parameters<typeof read>
  ) => {
    world.journal.push('read');
    return read(...args);
  }) as typeof read;
  const operations = createRoundMediaOperations(world.input);
  const [affirmative, negative, judge] = world.seats;
  await operations.session(world.roundId, affirmative.actorId);
  world.connect(negative.id, { publish: [], subscribe: false, hidden: false });
  world.connect(judge.id, {
    publish: ['microphone'],
    subscribe: true,
    hidden: true,
  });
  world.journal.length = 0;
  const writes = () =>
    world.journal.filter((entry) => entry.startsWith('permissions'));
  return { world, operations, negative, judge, writes };
};

test('reconcile closes every stale microphone before opening one, then idles', async () => {
  const { world, operations, negative, judge, writes } = await floorChange();
  await operations.reconcile(world.roundId);
  const first = writes();
  world.journal.length = 0;
  await operations.reconcile(world.roundId);
  assert({
    given: 'a judge still holding a microphone and a debater not yet opened',
    should:
      'close the judge microphone first, open the debater after, and make no writes once converged',
    actual: [first, world.connected.get(world.identity(judge.id)), writes()],
    expected: [
      [
        `permissions:${world.identity(judge.id)}:-`,
        `permissions:${world.identity(negative.id)}:camera+microphone`,
      ],
      { publish: [], subscribe: true, hidden: true },
      [],
    ],
  });
});

test('reconcile reads the session no more than it must before closing a stale microphone', async () => {
  const { world, operations, writes } = await floorChange();
  await operations.reconcile(world.roundId);
  const close = world.journal.indexOf(writes()[0]!);
  assert({
    given: 'a floor change whose stale microphone must close first (ISSUE-572)',
    should:
      'read the session for cleanup and for the publishers, and not again before the close',
    actual: world.journal.slice(0, close).filter((entry) => entry === 'read')
      .length,
    expected: 2,
  });
});

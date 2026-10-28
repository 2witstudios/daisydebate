import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

/** A live Round whose affirmative debater already holds an admission. */
const live = async () => {
  const world = createMediaWorld({ status: 'active' });
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, world.seats[0].actorId);
  return { world, operations };
};

test('a reconcile whose transaction loses its connection keeps the live room, and capture continues (ISSUE-803)', async () => {
  const { world, operations } = await live();
  world.drop('readMediaSession');
  await operations.recoverActiveSessions();
  const after = world.state();
  const captured = await operations.holdForCapture(
    world.sessionId,
    async () => 'heard',
  );
  assert({
    given:
      'a recovery pass whose session read drops its connection mid-transaction',
    should:
      'defer the pass without marking the session unsafe, keep the room, and let capture run on the next pass',
    actual: {
      unsafe: after.unsafe,
      ended: after.ended,
      room: world.rooms.has(world.roomName),
      deferred: world.logged.includes('round.media.reconcile_deferred'),
      unsafeLogged: world.logged.includes('round.media.unsafe'),
      captured,
    },
    expected: {
      unsafe: false,
      ended: false,
      room: true,
      deferred: true,
      unsafeLogged: false,
      captured: { value: 'heard' },
    },
  });
});

test('a vendor-mutation write that loses its connection defers the pass, and the retry applies it in the kept room (ISSUE-803)', async () => {
  const { world, operations } = await live();
  // A joined seat whose grants are stale, so reconcile must write a permission update.
  world.connect(world.seats[1].id, {
    publish: [],
    subscribe: false,
    hidden: false,
  });
  world.drop('beginMediaMutation');
  await assertRejects({
    given: 'a reconcile whose permission-mutation write drops its connection',
    should: 'fail that pass as retryable infrastructure',
    actual: () => operations.reconcile(world.roundId),
    code: 'INFRASTRUCTURE',
  });
  const kept = {
    unsafe: world.state().unsafe,
    room: world.rooms.has(world.roomName),
  };
  const retried = await operations.reconcile(world.roundId);
  assert({
    given: 'the same reconcile retried after the dropped connection',
    should:
      'have kept the room and the session safe, then reconcile it as usual',
    actual: { kept, state: retried.state, unsafe: world.state().unsafe },
    expected: {
      kept: { unsafe: false, room: true },
      state: 'ready',
      unsafe: false,
    },
  });
});

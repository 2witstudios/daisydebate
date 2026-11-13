import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

const seenAndHeard = {
  publish: ['camera', 'microphone'],
  subscribe: true,
  hidden: false,
  capture: false,
};

/** A Round whose host chose the call, with a debater and the judge in its room, now completed. */
const completedWithCall = async () => {
  const world = createMediaWorld({ postRoundCall: true });
  const operations = createRoundMediaOperations(world.input);
  const [affirmative, , judge] = world.seats;
  await operations.session(world.roundId, affirmative.actorId);
  await operations.session(world.roundId, judge.actorId);
  const roundRoom = world.currentRoom();
  world.end();
  return { world, operations, affirmative, judge, roundRoom };
};

test('a completed Round whose host chose the call moves to a fresh room', async () => {
  const { world, operations, affirmative, roundRoom } =
    await completedWithCall();
  await operations.recoverActiveSessions();
  const read = await operations.read(world.roundId, affirmative.actorId);
  assert({
    given: 'the Round completing with people in its room',
    should:
      'delete that room, keep the session open and name a room nobody holds a token for',
    actual: [
      world.journal.filter((call) => call === 'delete').length,
      world.rooms.has(roundRoom),
      world.state().ended,
      world.currentRoom() === roundRoom,
      read.state,
      read.mediaRoomName === world.currentRoom(),
    ],
    expected: [1, false, false, false, 'unavailable', true],
  });
});

test('everyone human on the call is seen and heard, the judge by seat only', async () => {
  const { world, operations, affirmative, judge } = await completedWithCall();
  await operations.recoverActiveSessions();
  const debater = await operations.session(world.roundId, affirmative.actorId);
  const judging = await operations.session(world.roundId, judge.actorId);
  assert({
    given: 'a debater and the judge joining the open call',
    should: 'grant both camera and microphone, the judge visible',
    actual: [debater.grants, judging.grants],
    expected: [seenAndHeard, seenAndHeard],
  });
  assert({
    given: 'the call as the judge reads it',
    should: 'list the debater as a peer and the judge by seat, never as a peer',
    actual: [
      judging.peers.map((peer) => peer.participantId),
      judging.callJudges?.map((seat) => [seat.slot, seat.microphone]),
    ],
    expected: [[affirmative.id], [[0, true]]],
  });
  assert({
    given: 'the call room',
    should: 'be created once, under the session’s new name',
    actual: [
      world.journal.filter((call) => call === 'create').length,
      world.rooms.has(world.currentRoom()),
    ],
    expected: [2, true],
  });
});

test('no token exists for the call while the Round’s room may still stand', async () => {
  const { world, operations, affirmative, roundRoom } =
    await completedWithCall();
  world.fail('deleteRoom');
  await operations.recoverActiveSessions().catch(() => undefined);
  assert({
    given: 'the Round’s room surviving a failed delete',
    should: 'keep the session on that room, the call unopened',
    actual: [world.currentRoom() === roundRoom, world.state().ended],
    expected: [true, false],
  });
  await assertRejects({
    given: 'an admission while the call is still opening',
    should: 'ask the caller to come back, signing nothing',
    code: 'INFRASTRUCTURE',
    actual: () => operations.session(world.roundId, affirmative.actorId),
  });
});

test('a completed Round whose host did not choose the call ends as before', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const [affirmative] = world.seats;
  await operations.session(world.roundId, affirmative.actorId);
  world.end();
  await operations.recoverActiveSessions();
  assert({
    given: 'the Round completing with no call chosen',
    should: 'end the session',
    actual: world.state().ended,
    expected: true,
  });
});

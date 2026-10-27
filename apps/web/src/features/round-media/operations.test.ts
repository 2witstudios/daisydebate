import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

/** A world whose affirmative debater already holds a live admission. */
const admitted = async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, world.seats[0].actorId);
  return { world, operations, affirmative: world.seats[0] };
};
const conversation = {
  publish: ['camera', 'microphone'] as ('camera' | 'microphone')[],
  subscribe: true,
  hidden: false,
};

test('a seated human admission creates the vendor room once and signs its own grants', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const [affirmative, negative] = world.seats;
  const first = await operations.session(world.roundId, affirmative.actorId);
  const second = await operations.session(world.roundId, negative.actorId);
  assert({
    given: 'two debaters admitted before the first segment',
    should:
      'create one room and return ready conversation grants on the public URL',
    actual: [
      world.journal.filter((call) => call === 'create').length,
      first.state,
      first.grants,
      first.url,
      second.identity === first.identity,
      first.peers.map((peer) => peer.participantId),
    ],
    expected: [
      1,
      'ready',
      { ...conversation, capture: false },
      'wss://media.daisy.invalid',
      false,
      [affirmative.id],
    ],
  });
});

test('a judge admission is hidden and never listed as a peer', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const [affirmative, , judge] = world.seats;
  await operations.session(world.roundId, affirmative.actorId);
  const admitted = await operations.session(world.roundId, judge.actorId);
  assert({
    given: 'an assigned judge joining after a debater',
    should: 'subscribe hidden without publishing and stay out of peers',
    actual: [admitted.grants, admitted.peers.map((p) => p.participantId)],
    expected: [
      { publish: [], subscribe: true, hidden: true, capture: false },
      [affirmative.id],
    ],
  });
});

test('a caller outside the Round is refused before any vendor write', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  await assertRejects({
    given: 'an actor holding no seat',
    should: 'refuse admission',
    code: 'AUTHORIZATION',
    actual: () => operations.session(world.roundId, 'outsider000000000000000'),
  });
  assert({
    given: 'the refused admission',
    should: 'leave the vendor untouched',
    actual: world.journal,
    expected: [],
  });
});

test('revoked bound seats rotate the room and remaining humans rejoin without restoring eligibility', async () => {
  const { world, operations, affirmative } = await admitted();
  const judge = world.seats[2];
  await operations.session(world.roundId, judge.actorId);
  const oldRoom = world.snapshot().session.roomName;
  world.revoke(judge.id);
  const reopened = await operations.session(world.roundId, affirmative.actorId);
  const current = world.snapshot();
  assert({
    given: 'a revoked judge holding an old-room token',
    should:
      'rotate on admission, remove only the revoked binding and admit the debater',
    actual: [
      reopened.state,
      current.session.roomName !== oldRoom,
      world.rooms.has(oldRoom),
      world.rooms.has(current.session.roomName),
      current.bindings.map((binding) => binding.roundParticipantId),
    ],
    expected: ['ready', true, false, true, [affirmative.id]],
  });
  await assertRejects({
    given: 'the still-revoked judge',
    should: 'deny a new grant',
    code: 'AUTHORIZATION',
    actual: () => operations.session(world.roundId, judge.actorId),
  });
});

test('an ineligible human without a token-bearing binding does not close media', async () => {
  const { world, operations, affirmative } = await admitted();
  world.revoke(world.seats[2].id);
  await operations.recoverActiveSessions();
  assert({
    given: 'a revoked seat that never joined media',
    should: 'retain the existing room and admit remaining eligible seats',
    actual: [
      (await operations.session(world.roundId, affirmative.actorId)).state,
      world.journal.includes('delete'),
    ],
    expected: ['ready', false],
  });
});

test('a terminal Round is cleaned up once and then reads as ended', async () => {
  const { world, operations, affirmative } = await admitted();
  world.end();
  await operations.recoverActiveSessions();
  await operations.recoverActiveSessions();
  const read = await operations.read(world.roundId, affirmative.actorId);
  assert({
    given: 'a completed Round recovered twice',
    should: 'delete its room once, stamp the session ended and expose no peers',
    actual: [
      world.journal.filter((call) => call === 'delete').length,
      world.state().ended,
      read.state,
      read.peers,
    ],
    expected: [1, true, 'ended', []],
  });
  await assertRejects({
    given: 'an admission after the Round ended',
    should: 'refuse it',
    code: 'CONFLICT',
    actual: () => operations.session(world.roundId, affirmative.actorId),
  });
});

/** An admitted affirmative, then a permission update whose vendor outcome is unknown. */
const unsafeWithPendingMutation = async () => {
  const { world, operations, affirmative } = await admitted();
  world.connect(world.seats[1].id, {
    publish: [],
    subscribe: false,
    hidden: false,
  });
  world.fail('updateParticipant');
  const refused = await operations.reconcile(world.roundId);
  return { world, operations, affirmative, refused };
};

test('a failed vendor update leaves the session unsafe until cleanup proves absence', async () => {
  const { world, operations, affirmative, refused } =
    await unsafeWithPendingMutation();
  const unsafe = world.state();
  await assertRejects({
    given: 'an admission while the failed mutation is unresolved',
    should: 'refuse as an infrastructure fault',
    code: 'INFRASTRUCTURE',
    actual: () => operations.session(world.roundId, affirmative.actorId),
  });
  assert({
    given: 'a permission update whose outcome is unknown',
    should: 'persist it as unsafe, report it, and stop serving the room',
    actual: [
      refused.state,
      unsafe.unsafe,
      unsafe.pending,
      world.reported.length > 0,
    ],
    expected: ['unavailable', true, 1, true],
  });
});

test('a reachable vendor failure during cleanup is retried on the next run', async () => {
  const { world, operations } = await admitted();
  world.end();
  world.fail('listRooms');
  await operations.recoverActiveSessions();
  const first = world.state();
  await operations.recoverActiveSessions();
  assert({
    given: 'a terminal cleanup whose first absence read fails',
    should: 'stay unsafe and not ended, then finish on the next recovery',
    actual: [first.unsafe, first.ended, world.state().ended],
    expected: [true, false, true],
  });
});

test('a busy reconcile lease is awaited rather than refused', async () => {
  const world = createMediaWorld({ busyClaims: 2 });
  const operations = createRoundMediaOperations(world.input);
  const admitted = await operations.session(
    world.roundId,
    world.seats[0].actorId,
  );
  assert({
    given: 'another worker holding the session lease twice',
    should: 'wait for the lease and still admit',
    actual: admitted.state,
    expected: 'ready',
  });
});

test('an admission issues its token under its own reconcile lease (ISSUE-534)', async () => {
  const world = createMediaWorld({ reclaimedAfterFinish: true });
  const operations = createRoundMediaOperations(world.input);
  const admitted = await operations.session(
    world.roundId,
    world.seats[1].actorId,
  );
  assert({
    given:
      'another worker claiming the reconcile lease the instant each of ours finishes',
    should:
      'admit after one reconcile, its token issued before the lease is released',
    actual: [admitted.state, world.reconciles()],
    expected: ['ready', 1],
  });
});

test('an admission to an unsafe session with pending vendor work refuses after one reconcile', async () => {
  const { world, operations, affirmative } = await unsafeWithPendingMutation();
  const before = world.reconciles();
  await assertRejects({
    given:
      'a session left unsafe by an unknown vendor outcome, its mutation pending',
    should: 'refuse as an infrastructure fault',
    code: 'INFRASTRUCTURE',
    actual: () => operations.session(world.roundId, affirmative.actorId),
  });
  assert({
    given: 'that refused admission',
    should: 'run one cleanup reconcile, not retry',
    actual: world.reconciles() - before,
    expected: 1,
  });
});

test('recovery reports a session it cannot read without stopping the scan', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, world.seats[0].actorId);
  world.fail('listRooms', 3);
  const reported = world.reported.length;
  await operations.recoverActiveSessions();
  assert({
    given: 'a vendor outage while recovering active sessions',
    should: 'report the failure to the error tracker',
    actual: world.reported.length > reported,
    expected: true,
  });
});

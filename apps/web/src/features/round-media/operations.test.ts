import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import {
  createRoundMediaOperations,
  isMediaDeferred,
  MEDIA_ADMISSION_WAIT_MS,
} from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

/** A world whose affirmative debater already holds a live admission. */
const admitted = async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, world.seats[0].actorId);
  return { world, operations, affirmative: world.seats[0] };
};
/** Reads stay unserved and no pass can claim until the test opens the loop. */
const closeTheLoop = (world: ReturnType<typeof createMediaWorld>) => {
  let open = false;
  let polls = 0;
  const progress = world.input.store.mediaReconcileProgress;
  world.input.store.mediaReconcileProgress = (async (sessionId: string) => {
    polls++;
    const answer = await progress(sessionId);
    return open ? answer : { ...answer, servedVersion: -1 };
  }) as typeof progress;
  const claim = world.input.store.claimMediaReconcile;
  world.input.store.claimMediaReconcile = (async (
    ...args: Parameters<typeof claim>
  ) =>
    open
      ? claim(...args)
      : {
          kind: 'wait',
          reason: 'lease',
          retryAt: '',
        }) as unknown as typeof claim;
  return { open: () => void (open = true), polls: () => polls };
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
    should:
      'defer without marking the session unsafe, then finish on the next recovery (ISSUE-803)',
    actual: [first.unsafe, first.ended, world.state().ended],
    expected: [false, false, true],
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

test("an admission refused at room creation carries its own refusal; another's race stays retryable", async () => {
  const ended: ReturnType<typeof createMediaWorld> = createMediaWorld({
    status: 'active',
    beforeFirstMutation: () => ended.end(),
  });
  const raced = createMediaWorld({
    status: 'active',
    beforeFirstMutation: () => {
      throw createAppError('CONFLICT', 'Media reconciliation lease changed');
    },
  });
  const admit = (world: ReturnType<typeof createMediaWorld>) =>
    createRoundMediaOperations(world.input).session(
      world.roundId,
      world.seats[0].actorId,
    );
  await assertRejects({
    given: 'the Round ending as the caller’s room is created',
    should: 'refuse with the admission’s own CONFLICT',
    code: 'CONFLICT',
    actual: () => admit(ended),
  });
  await assertRejects({
    given: 'a reconcile lease race as the room is created',
    should: 'stay INFRASTRUCTURE, which a client retries',
    code: 'INFRASTRUCTURE',
    actual: () => admit(raced),
  });
});

test('a browser admission stops waiting at its bound or when its client leaves', async () => {
  const outcomes = [];
  for (const leave of ['bound', 'client'] as const) {
    const world = createMediaWorld();
    let nowMs = 0;
    let claims = 0;
    const client = new AbortController();
    world.input.store.claimMediaReconcile = (async () => {
      claims++;
      return { kind: 'busy' };
    }) as unknown as typeof world.input.store.claimMediaReconcile;
    const operations = createRoundMediaOperations({
      ...world.input,
      now: () => nowMs,
      wait: async () => {
        nowMs += 1_000;
        if (leave === 'client' && nowMs === 3_000) client.abort();
      },
    });
    const failure = await operations
      .session(world.roundId, world.seats[0].actorId, client.signal)
      .catch((error: { code?: string }) => error.code);
    outcomes.push([failure, nowMs, claims]);
  }
  assert({
    given: 'a lease another reconcile keeps holding',
    should:
      'answer the retryable 503 below the client deadline, or as soon as the client aborts, with no further claim',
    actual: outcomes,
    expected: [
      ['INFRASTRUCTURE', MEDIA_ADMISSION_WAIT_MS, 8],
      ['INFRASTRUCTURE', 3_000, 3],
    ],
  });
});

/** An admitted seat, and the session read a test can wrap. */
const admittedReader = async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const actor = world.seats[0].actorId;
  await operations.session(world.roundId, actor);
  const read = world.input.store.readMediaSession;
  return { world, operations, actor, read };
};

test('a read crossing a vendor write in flight defers instead of refusing', async () => {
  const { world, operations, actor, read } = await admittedReader();
  world.input.store.readMediaSession = (async (
    ...args: Parameters<typeof read>
  ) => {
    const state = await read(...args);
    return state && { ...state, unresolved: true };
  }) as typeof read;
  const failure = await operations
    .reconcile(world.roundId, actor)
    .catch((error: unknown) => error);
  assert({
    given: 'an unsettled vendor write while this seat reads',
    should: 'answer the retryable deferral, not a refusal of its media',
    actual: isMediaDeferred(failure),
    expected: true,
  });
});

test('an abandoned read stops serving', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const client = new AbortController();
  client.abort();
  const failure = await operations
    .reconcile(world.roundId, world.seats[0].actorId, client.signal)
    .catch((error: unknown) => error);
  assert({
    given: 'a read whose client has already left',
    should: 'stop instead of running a pass for nobody',
    actual: [isMediaDeferred(failure), world.reconciles()],
    expected: [true, 0],
  });
});

test('concurrent reads of one session share one polling loop', async () => {
  const world = createMediaWorld();
  const actor = world.seats[0].actorId;
  const operations0 = createRoundMediaOperations(world.input);
  await operations0.session(world.roundId, actor);
  const gate = Promise.withResolvers<void>();
  const closed = closeTheLoop(world);
  const operations = createRoundMediaOperations({
    ...world.input,
    wait: () => gate.promise,
  });
  const reads = Array.from({ length: 5 }, () =>
    operations.reconcile(world.roundId, actor),
  );
  for (let turn = 0; turn < 5; turn++)
    await new Promise((done) => setImmediate(done));
  const pollsBeforeNextTick = closed.polls();
  closed.open();
  gate.resolve();
  const settled = await Promise.allSettled(reads);
  assert({
    given: 'five reads of one session, all held at the same polling wait',
    should: 'have polled once between them, and answer them all',
    actual: [
      pollsBeforeNextTick,
      settled.every((read) => read.status === 'fulfilled'),
    ],
    expected: [1, true],
  });
});

test('a read that leaves stops waiting while the others keep being served', async () => {
  const world = createMediaWorld();
  const actor = world.seats[0].actorId;
  const closed = closeTheLoop(world);
  const tick = Promise.withResolvers<void>();
  const operations = createRoundMediaOperations({
    ...world.input,
    wait: async () => {
      tick.resolve();
      await new Promise(setImmediate);
    },
  });
  const leaving = new AbortController();
  const stays = operations.reconcile(world.roundId, actor);
  const leaves = operations
    .reconcile(world.roundId, actor, leaving.signal)
    .catch((error: unknown) => error);
  await tick.promise;
  leaving.abort();
  const failure = await leaves;
  closed.open();
  await stays;
  assert({
    given: 'two reads waiting on one session, one of which is abandoned',
    should: 'release the abandoned one at once and still serve the other',
    actual: failure === leaving.signal.reason,
    expected: true,
  });
});

test('a read after every earlier read left still gets its own pass', async () => {
  const { world, affirmative } = await admitted();
  const held = Promise.withResolvers<void>();
  const inPass = Promise.withResolvers<void>();
  const { media } = world.input;
  const operations = createRoundMediaOperations({
    ...world.input,
    media: {
      ...media,
      publicationPermissions: async (room: string) => {
        inPass.resolve();
        await held.promise;
        return media.publicationPermissions(room);
      },
    },
  });
  const passesBefore = world.reconciles();
  const client = new AbortController();
  const leaving = operations
    .reconcile(world.roundId, affirmative.actorId, client.signal)
    .catch((error: unknown) => error);
  await inPass.promise;
  client.abort();
  const failure = await leaving;
  const fresh = operations.reconcile(world.roundId, affirmative.actorId);
  held.resolve();
  await fresh;
  const { served } = world.state();
  const newest = await world.input.store.requestMediaReconcile({
    roundId: world.roundId,
  });
  assert({
    given: 'the only read abandoned mid pass, then a newer read for the room',
    should:
      'release the abandoned read at once, finish its pass, and run a further pass for the newer read',
    actual: [
      failure === client.signal.reason,
      world.reconciles() - passesBefore,
      served,
    ],
    expected: [true, 2, newest.version - 1],
  });
});

test('a read whose version is served does not wait for later reads', async () => {
  const { world, affirmative } = await admitted();
  const passes: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const started = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const { media } = world.input;
  const operations = createRoundMediaOperations({
    ...world.input,
    media: {
      ...media,
      publicationPermissions: async (room: string) => {
        const pass = Promise.withResolvers<void>();
        started[passes.length]?.resolve();
        passes.push(pass);
        await pass.promise;
        return media.publicationPermissions(room);
      },
    },
  });
  let earlierAnswered = false;
  const earlier = operations
    .reconcile(world.roundId, affirmative.actorId)
    .then(() => {
      earlierAnswered = true;
    });
  await started[0]!.promise;
  const later = operations.reconcile(world.roundId, affirmative.actorId);
  await new Promise(setImmediate);
  passes[0]!.resolve();
  await started[1]!.promise;
  await earlier;
  const answeredDuringLaterPass = earlierAnswered;
  passes[1]!.resolve();
  await later;
  assert({
    given: 'an earlier read served while a later read still needs a pass',
    should: 'answer the earlier read during the later pass',
    actual: answeredDuringLaterPass,
    expected: true,
  });
});

test('a later pass failing does not fail a read already served', async () => {
  const { world, affirmative } = await admitted();
  const first = Promise.withResolvers<void>();
  const inFirst = Promise.withResolvers<void>();
  let calls = 0;
  const { media } = world.input;
  const operations = createRoundMediaOperations({
    ...world.input,
    media: {
      ...media,
      publicationPermissions: async (room: string) => {
        if (++calls === 1) {
          inFirst.resolve();
          await first.promise;
          return media.publicationPermissions(room);
        }
        throw new Error('vendor down');
      },
    },
  });
  const earlier = operations.reconcile(world.roundId, affirmative.actorId);
  await inFirst.promise;
  const later = operations
    .reconcile(world.roundId, affirmative.actorId)
    .catch((error: unknown) => error);
  await new Promise(setImmediate);
  first.resolve();
  const answer = await earlier;
  assert({
    given:
      'a read served by a pass, and the next pass failing for a later read',
    should: 'answer the served read and fail only the later one',
    actual: [answer.state, (await later) instanceof Error],
    expected: ['ready', true],
  });
});

test('a failed pass defers every reader rather than answering for it', async () => {
  const { world, affirmative } = await admitted();
  const conflict = createAppError(
    'CONFLICT',
    'Media reconciliation lease changed',
  );
  const outcomes: unknown[] = [];
  for (const fault of [
    { finishMediaReconcile: () => Promise.reject(conflict) },
    { mediaReconcileProgress: () => Promise.reject(new Error('down')) },
  ]) {
    const operations = createRoundMediaOperations({
      ...world.input,
      store: { ...world.input.store, ...fault },
    });
    const reads = await Promise.all(
      [0, 1].map(() =>
        operations
          .reconcile(world.roundId, affirmative.actorId)
          .catch((error: unknown) => error),
      ),
    );
    outcomes.push(reads.map(isMediaDeferred));
  }
  assert({
    given: 'two reads on a pass whose lease is lost, or whose polling fails',
    should:
      'give each the retryable deferral, not an authority answer or a 500',
    actual: outcomes,
    expected: [
      [true, true],
      [true, true],
    ],
  });
});

test('a fault the readers only see as a deferral still reaches the tracker', async () => {
  const { world, affirmative } = await admitted();
  const fault = new Error('database timeout');
  const reported: unknown[] = [];
  const operations = createRoundMediaOperations({
    ...world.input,
    reporter: { capture: (error: unknown) => void reported.push(error) },
    store: {
      ...world.input.store,
      mediaReconcileProgress: () => Promise.reject(fault),
    },
  });
  await operations
    .reconcile(world.roundId, affirmative.actorId)
    .catch(() => undefined);
  assert({
    given: 'a polling fault with a browser read waiting',
    should: 'report the raw error',
    actual: reported,
    expected: [fault],
  });
});

test('an abandoned admission takes no round lock', async () => {
  const world = createMediaWorld();
  let binds = 0;
  const lock = world.input.store.ensureBinding;
  world.input.store.ensureBinding = ((...args: Parameters<typeof lock>) => {
    binds++;
    return lock(...args);
  }) as typeof lock;
  const client = new AbortController();
  client.abort();
  await createRoundMediaOperations(world.input)
    .session(world.roundId, world.seats[0].actorId, client.signal)
    .catch(() => undefined);
  assert({
    given: 'an admission abandoned before it reached the binding',
    should: 'not take the round lock',
    actual: binds,
    expected: 0,
  });
});

test('an abandoned read takes no round lock', async () => {
  const world = createMediaWorld();
  let requests = 0;
  const request = world.input.store.requestMediaReconcile;
  world.input.store.requestMediaReconcile = ((
    ...args: Parameters<typeof request>
  ) => {
    requests++;
    return request(...args);
  }) as typeof request;
  const client = new AbortController();
  client.abort();
  await createRoundMediaOperations(world.input)
    .reconcile(world.roundId, world.seats[0].actorId, client.signal)
    .catch(() => undefined);
  assert({
    given: 'a read abandoned before it reached the request',
    should: 'not ask for a reconcile',
    actual: requests,
    expected: 0,
  });
});

test('a vendor write beginning after the check still cannot refuse the read', async () => {
  const { world, operations, actor, read } = await admittedReader();
  let callerReads = 0;
  world.input.store.readMediaSession = (async (
    ...args: Parameters<typeof read>
  ) => {
    const state = await read(...args);
    if (args[0].actorId !== actor) return state;
    callerReads++;
    return state && { ...state, unresolved: callerReads > 1 };
  }) as typeof read;
  const answer = await operations.reconcile(world.roundId, actor);
  assert({
    given: 'a write that a later read of the session would see as unsettled',
    should: 'answer from the snapshot the check used, reading it once',
    actual: [answer.state, callerReads],
    expected: ['ready', 1],
  });
});

test('a failed vendor read keeps its cause for the error tracker', async () => {
  const world = createMediaWorld();
  const cause = new Error('vendor down');
  const operations = createRoundMediaOperations({
    ...world.input,
    media: { ...world.input.media, exists: () => Promise.reject(cause) },
  });
  const failure = await operations
    .read(world.roundId, world.seats[0].actorId)
    .catch((error: Error) => error);
  assert({
    given: 'a vendor call failing during a read',
    should: 'answer INFRASTRUCTURE with the original error as its cause',
    actual: (failure as Error).cause,
    expected: cause,
  });
});

test('a read arriving as a poll finishes still waits for its own version', async () => {
  const world = createMediaWorld();
  const actor = world.seats[0].actorId;
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, actor);
  const first = operations.reconcile(world.roundId, actor);
  const reads = [first];
  // Join on every microtask while the first read's loop is finishing.
  for (let tick = 0; tick < 40; tick++) {
    await Promise.resolve();
    reads.push(operations.reconcile(world.roundId, actor));
  }
  await Promise.all(reads);
  const { served } = world.state();
  const requested = await world.input.store.requestMediaReconcile({
    roundId: world.roundId,
  });
  assert({
    given: 'reads joining at every step of a finishing poll',
    should: 'leave every requested version before the last one served',
    actual: served >= requested.version - 1,
    expected: true,
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMediaController } from '../src/features/round-media/media-controller';
import {
  createRoundMediaOperations,
  MEDIA_ADMISSION_WAIT_MS,
} from '../src/features/round-media/operations';
import {
  createMediaRequest,
  MEDIA_REQUEST_DEADLINE_MS,
  MEDIA_RETRY_DELAYS_MS,
} from '../src/features/round-media/request-media';
import { mediaDependencies, withMediaRound } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

const RETRY_BUDGET_MS =
  4 * MEDIA_REQUEST_DEADLINE_MS +
  MEDIA_RETRY_DELAYS_MS.reduce((total, pause) => total + pause, 0);
const SLOW_PASS_MS = 1_000;
type Fixture = Parameters<Parameters<typeof withMediaRound>[0]>[0];

/** The real browser adapter and controller over real operations and PostgreSQL. */
const browserClient = (
  operations: ReturnType<typeof createRoundMediaOperations>,
  roundId: string,
  actorId: string,
) => {
  const counts = { admissionCalls: 0, connects: 0, admittedAtMs: -1 };
  const startedAtMs = performance.now();
  const answer = async (work: () => Promise<unknown>) => {
    try {
      return Response.json(await work());
    } catch (error) {
      const code = (error as { code?: string }).code;
      return new Response('{}', {
        status: code === 'INFRASTRUCTURE' ? 503 : 500,
      });
    }
  };
  const request = createMediaRequest({
    scheduleDeadline: (expire, ms) => {
      const timer = setTimeout(expire, ms);
      return () => clearTimeout(timer);
    },
    fetch: (url, options) => {
      if (String(url).endsWith('/reconcile'))
        return answer(() => operations.reconcile(roundId, actorId));
      counts.admissionCalls++;
      return answer(() =>
        operations.session(
          roundId,
          actorId,
          options?.signal ?? new AbortController().signal,
        ),
      );
    },
  });
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 0,
    api: {
      admit: (id, signal) => request(id, 'session', signal),
      reconcile: (id, signal) => request(id, 'reconcile', signal),
    },
    retry: {
      delaysMs: MEDIA_RETRY_DELAYS_MS,
      wait: (ms) => Bun.sleep(ms),
    },
    transport: () => ({
      connect: async () => {
        counts.connects++;
        counts.admittedAtMs = performance.now() - startedAtMs;
      },
      apply: async () => undefined,
      allowRecapture: () => undefined,
      stopTracks: () => undefined,
      disconnect: async () => undefined,
    }),
    changed: () => undefined,
  });
  return { controller, counts };
};

/** A real claim, past the 500 ms the store requires between passes. */
const claimLease = async (
  store: ReturnType<typeof mediaDependencies>['store'],
  sessionId: string,
  owner: string,
) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const claim = await store.claimMediaReconcile({ sessionId, owner });
    if (claim.kind === 'claimed') return claim.kind;
    await Bun.sleep(200);
  }
  return 'wait';
};

const sessionIdOf = async (f: Fixture) => {
  const [session] =
    await f.sql`select id from media_sessions where round_id=${f.roundId}`;
  return String(session!.id);
};

test('several seats admit within the retry budget when every pass takes a second', async () => {
  await withMediaRound(async (f) => {
    const dependencies = mediaDependencies(f);
    const slow = {
      ...dependencies.media,
      exists: async (room: string) => {
        await Bun.sleep(SLOW_PASS_MS);
        return dependencies.media.exists(room);
      },
    };
    const operations = createRoundMediaOperations({
      ...dependencies,
      media: slow,
    });
    const clients = [
      f.host.actorId,
      f.guest.actorId,
      f.host.actorId,
      f.guest.actorId,
    ].map((actorId) => browserClient(operations, f.roundId, actorId));
    await Promise.all(clients.map(({ controller }) => controller.join()));
    const sessionId = await sessionIdOf(f);
    assert({
      given:
        'four browser admissions contending for one session, each pass over 1 s',
      should: 'connect every client once, within budget, leaving no waiter',
      actual: {
        states: clients.map(({ controller }) => controller.state()),
        connects: clients.map(({ counts }) => counts.connects),
        withinBudget: clients.every(
          ({ counts }) =>
            counts.admittedAtMs > 0 && counts.admittedAtMs < RETRY_BUDGET_MS,
        ),
        waiting: await dependencies.priority(sessionId, 'waiting'),
      },
      expected: {
        states: ['live', 'live', 'live', 'live'],
        connects: [1, 1, 1, 1],
        withinBudget: true,
        waiting: false,
      },
    });
    for (const { controller } of clients) controller.stop();
  });
}, 90_000);

test('an admission outlasting a held lease retries through, and an abandoned one stops', async () => {
  await withMediaRound(async (f) => {
    const dependencies = mediaDependencies(f);
    const operations = createRoundMediaOperations(dependencies);
    await operations.session(f.roundId, f.host.actorId);
    const sessionId = await sessionIdOf(f);
    const foreignClaim = await claimLease(
      dependencies.store,
      sessionId,
      dependencies.nextId(),
    );
    const client = new AbortController();
    const abandonedAt = performance.now();
    const abandoned = operations
      .session(f.roundId, f.guest.actorId, client.signal)
      .catch((error: { code?: string }) => error.code);
    setTimeout(() => client.abort(), 100);
    const abandonedOutcome = await abandoned;
    const abandonedMs = performance.now() - abandonedAt;
    const waitingAfterAbandon = await dependencies.priority(
      sessionId,
      'waiting',
    );
    const browser = browserClient(operations, f.roundId, f.guest.actorId);
    await browser.controller.join();
    const afterLease = await claimLease(
      dependencies.store,
      sessionId,
      dependencies.nextId(),
    );
    assert({
      given: 'a foreign reconcile holding the real lease to its full expiry',
      should:
        'stop the abandoned waiter at once, answer 503 at the bound, admit on a retry and leave the lease claimable',
      actual: {
        foreignClaim,
        abandonedOutcome,
        abandonedQuickly: abandonedMs < 1_000,
        waitingAfterAbandon,
        state: browser.controller.state(),
        retried: browser.counts.admissionCalls >= 2,
        connects: browser.counts.connects,
        admittedAfterBound:
          browser.counts.admittedAtMs > MEDIA_ADMISSION_WAIT_MS,
        withinBudget: browser.counts.admittedAtMs < RETRY_BUDGET_MS,
        afterLease,
      },
      expected: {
        foreignClaim: 'claimed',
        abandonedOutcome: 'INFRASTRUCTURE',
        abandonedQuickly: true,
        waitingAfterAbandon: false,
        state: 'live',
        retried: true,
        connects: 1,
        admittedAfterBound: true,
        withinBudget: true,
        afterLease: 'claimed',
      },
    });
    browser.controller.stop();
  });
}, 90_000);

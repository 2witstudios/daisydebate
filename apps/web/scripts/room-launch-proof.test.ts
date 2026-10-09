import { decodeLaunchEvidence } from '../e2e/support/room-launch-evidence-decoder';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchControl } from '../e2e/support/room-launch-control';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireLaunchSlot } from '../e2e/support/room-launch-slot';
setupRitewayBun();
const own = {
  DATABASE_URL: 'postgres://admin:local@localhost:5432/daisy_wt_proof',
  E2E_DATABASE_URL:
    'postgres://daisy_e2e:local@localhost:5432/daisy_wt_proof_e2e',
  E2E_REDIS_URL: 'redis://localhost:6379/2',
  E2E_REDIS_NAMESPACE: 'daisy-wt-proof-e2e',
  E2E_PORT: '13101',
};
const refusal = (checkout: string, env = own) => {
  try {
    requireLaunchSlot(checkout, env);
    return 'accepted';
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown';
  }
};
test('Launch proof refuses main, foreign databases, namespaces and remote services before opening resources', () => {
  assert({
    given: 'main, cross-slot and remote proof targets',
    should: 'refuse each target before any database or Redis connection',
    actual: [
      refusal('/repo'),
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace(
          'proof_e2e',
          'parent_e2e',
        ),
      }),
      refusal('/repo/wt-proof', { ...own, E2E_REDIS_NAMESPACE: 'daisy-e2e' }),
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace(
          'localhost',
          'remote.example',
        ),
      }),
    ],
    expected: Array(4).fill(
      'Launch proof requires its dedicated native worktree slot',
    ),
  });
});
test('Launch proof derives a single native suite-owned identity', () => {
  assert({
    given: 'matching own native worktree services',
    should: 'return only that worktree database, namespace and port',
    actual: requireLaunchSlot('/repo/wt-proof', own),
    expected: {
      id: 'proof',
      database: 'daisy_wt_proof_e2e',
      namespace: 'daisy-wt-proof-e2e',
      port: 13101,
    },
  });
});

test('private proof control waits for actual outstanding work and refuses unknown paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'room-launch-control-'));
  let release!: () => void;
  let entered!: () => void;
  const requested = new Promise<void>((accept) => {
    entered = accept;
  });
  const outstanding = new Promise<void>((accept) => {
    release = accept;
  });
  const control = createLaunchControl({
    path: join(directory, 'control.sock'),
    settled: () => {
      entered();
      return outstanding;
    },
    pending: () => 0,
  });
  try {
    await new Promise<void>((accept) => control.once('listening', accept));
    const { port } = JSON.parse(
      await readFile(join(directory, 'control.sock'), 'utf8'),
    );
    let answered = false;
    const called = fetch(`http://127.0.0.1:${port}/settled`, {
      method: 'POST',
    }).then((response) => {
      answered = true;
      return response;
    });
    await requested;
    assert({
      given: 'auth work still outstanding after the control request entered',
      should: 'hold the acknowledgement until that work settles',
      actual: answered,
      expected: false,
    });
    release();
    assert({
      given: 'real loopback listener and awaited work completion',
      should: 'acknowledge settlement and refuse unknown control paths',
      actual: [
        (await called).status,
        (await fetch(`http://127.0.0.1:${port}/unknown`)).status,
      ],
      expected: [204, 404],
    });
  } finally {
    await new Promise<void>((accept, reject) =>
      control.close((error) => (error ? reject(error) : accept())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

const emptyEvidence = {
  hash: 'a'.repeat(64),
  counts: {
    users: 0,
    actors: 4,
    rooms: 0,
    rounds: 0,
    seats: 0,
    roundSeats: 0,
    commands: 0,
    outbox: 0,
  },
  frozen: [],
  launchDoorbells: 0,
};
test('proof decoder rejects malformed, substituted, extra and negative worker evidence', () => {
  const rejected = (value: string) => {
    try {
      decodeLaunchEvidence(value);
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : 'unknown';
    }
  };
  assert({
    given:
      'malformed JSON and wrong hash, counts, frozen receipt or extra fields',
    should: 'refuse every forged evidence shape',
    actual: [
      rejected('malformed'),
      rejected(JSON.stringify({ ...emptyEvidence, hash: 'ok' })),
      rejected(JSON.stringify({ ...emptyEvidence, extra: true })),
      rejected(
        JSON.stringify({
          ...emptyEvidence,
          counts: { ...emptyEvidence.counts, rounds: -1 },
        }),
      ),
      rejected(
        JSON.stringify({
          ...emptyEvidence,
          counts: { ...emptyEvidence.counts, extra: 0 },
        }),
      ),
      rejected(
        JSON.stringify({ ...emptyEvidence, frozen: [{ status: 'scheduled' }] }),
      ),
    ],
    expected: Array(6).fill('Invalid Launch evidence payload'),
  });
  assert({
    given: 'exact portable empty-slot evidence',
    should: 'preserve the decoded evidence value',
    actual: decodeLaunchEvidence(JSON.stringify(emptyEvidence)),
    expected: emptyEvidence,
  });
});
test('Launch admission rejects substituted database roles and effective PostgreSQL ports', () => {
  assert({
    given: 'foreign runtime role or PostgreSQL server port',
    should: 'refuse both before opening services',
    actual: [
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace('daisy_e2e:', 'admin:'),
      }),
      refusal('/repo/wt-proof', {
        ...own,
        E2E_DATABASE_URL: own.E2E_DATABASE_URL.replace(':5432', ':5433'),
      }),
    ],
    expected: Array(2).fill(
      'Launch proof requires its dedicated native worktree slot',
    ),
  });
});

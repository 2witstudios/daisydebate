import { roomCreateSchema } from '@daisy/protocol';
import { launchCustomSelection } from '../e2e/support/room-launch-custom';
import { decodeLaunchEvidence } from '../e2e/support/room-launch-evidence-decoder';
import { createLaunchShutdown } from '../e2e/support/room-launch-shutdown';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchControl } from '../e2e/support/room-launch-control';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireLaunchSlot } from '../e2e/support/room-launch-slot';
setupRitewayBun();

test('custom browser creation fixture satisfies the canonical complete request contract', () => {
  const request = {
    commandId: 'a'.repeat(24),
    title: 'Custom sequence proof',
    topic: 'Proof transit motion',
    visibility: 'public',
    selection: launchCustomSelection,
  };
  const parsed = roomCreateSchema.safeParse(request);
  assert({
    given: 'the exact custom selection sent by the browser proof',
    should:
      'pass the complete canonical request decoder before HTTP submission',
    actual: parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.path.join('.')),
    expected: [],
  });
  const incomplete = roomCreateSchema.safeParse({
    ...request,
    selection: Object.fromEntries(
      Object.entries(launchCustomSelection).filter(([key]) => key !== 'length'),
    ),
  });
  assert({
    given: 'the same complete request with only its custom length omitted',
    should: 'refuse the missing field at the canonical request boundary',
    actual: incomplete.success
      ? []
      : incomplete.error.issues.map((issue) => issue.path.join('.')),
    expected: ['selection.length'],
  });
});

test('dedicated config refuses shared checkouts and binds dedicated paths', async () => {
  const checkout = resolve(import.meta.dir, '../../..');
  const folder = basename(checkout);
  const dedicated = folder.startsWith('wt-');
  const slot = folder.slice('wt-'.length).replaceAll('-', '_');
  const namespace = `daisy-wt-${slot.replaceAll('_', '-')}-e2e`;
  const script = `import config from './apps/web/e2e/support/room-launch-config';
    console.log(JSON.stringify({
      servers: config.webServer.map(server => server.cwd ?? null),
      artifacts: config.outputDir ?? null,
      report: config.reporter.find(reporter => reporter[0] === 'json')[1].outputFile,
    }));`;
  const loaded = Bun.spawn(['bun', '--eval', script], {
    cwd: checkout,
    env: {
      ...process.env,
      DATABASE_URL: `postgres://daisy:fixture@127.0.0.1:5432/daisy_wt_${slot}`,
      E2E_DATABASE_URL: `postgres://daisy_e2e:fixture@127.0.0.1:5432/daisy_wt_${slot}_e2e`,
      E2E_REDIS_URL: 'redis://127.0.0.1:6379/2',
      E2E_REDIS_NAMESPACE: namespace,
      E2E_PORT: '13001',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, output] = await Promise.all([
    loaded.exited,
    new Response(loaded.stdout).text(),
  ]);
  const errors = await new Response(loaded.stderr).text();
  if (!dedicated) {
    assert({
      given: 'the ordinary shared repository checkout',
      should: 'refuse before resolving browser servers or artifacts',
      actual: {
        output,
        refused:
          status !== 0 && errors.includes('dedicated native worktree slot'),
      },
      expected: { output: '', refused: true },
    });
    return;
  }
  assert({
    given: 'the actual dedicated config loaded from its nested support folder',
    should:
      'run web/realtime from their own workspaces and retain artifacts at the CI-registered paths',
    actual: { status, paths: JSON.parse(output) },
    expected: {
      status: 0,
      paths: {
        servers: [
          resolve(checkout, 'apps/web'),
          resolve(checkout, 'apps/realtime'),
        ],
        artifacts: resolve(checkout, 'apps/web/test-results'),
        report: resolve(
          checkout,
          'apps/web/test-results/room-launch-results.json',
        ),
      },
    },
  });
});

function shutdownFixture(settled: () => Promise<void>, rejectClose = false) {
  const calls: string[] = [];
  const shutdown = createLaunchShutdown({
    settled,
    closeControl: () => {
      calls.push('control');
      if (rejectClose) throw new Error('private close failure');
    },
    stopCapture: () => {
      calls.push('capture');
    },
    stopEdge: () => {
      calls.push('edge');
    },
    refused: () => {
      calls.push('refused');
    },
  });
  return { calls, shutdown };
}

test('Launch shutdown awaits auth settlement and closes each owned listener once', async () => {
  let release!: () => void;
  const outstanding = new Promise<void>((accept) => {
    release = accept;
  });
  const { calls, shutdown } = shutdownFixture(() => outstanding);
  const first = shutdown();
  const second = shutdown();
  assert({
    given: 'two signals while auth work remains outstanding',
    should: 'await settlement without stopping listeners',
    actual: calls,
    expected: [],
  });
  release();
  await Promise.all([first, second]);
  assert({
    given: 'auth work settled after repeated signals',
    should: 'close every owned listener exactly once',
    actual: calls,
    expected: ['control', 'capture', 'edge'],
  });
});

test('Launch shutdown continues cleanup after rejected settlement or control close', async () => {
  const { calls, shutdown } = shutdownFixture(
    () => Promise.reject(new Error('private settlement failure')),
    true,
  );
  await shutdown();
  assert({
    given: 'failed settlement and control close',
    should:
      'still stop capture and TLS and report a single bounded failure without rejection',
    actual: calls,
    expected: ['control', 'capture', 'edge', 'refused'],
  });
});
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
    assert({
      given: 'the real proof control listener closed',
      should: 'remove its owned descriptor through the bound cleanup handler',
      actual: await Bun.file(join(directory, 'control.sock')).exists(),
      expected: false,
    });
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

test('release entry sanitizes malformed lifecycle URLs before opening services', async () => {
  const checkout = resolve(import.meta.dir, '../../..');
  const id = basename(checkout).slice(3).replaceAll('-', '_');
  const run = Bun.spawn(
    ['bun', 'apps/web/e2e/support/room-launch-release.ts'],
    {
      cwd: checkout,
      env: {
        ...process.env,
        ...own,
        DATABASE_URL: `postgres://admin:local@localhost:5432/daisy_wt_${id}`,
        E2E_DATABASE_URL: `postgres://daisy_e2e:local@localhost:5432/daisy_wt_${id}_e2e`,
        E2E_REDIS_NAMESPACE: `daisy-wt-${id.replaceAll('_', '-')}-e2e`,
        TEST_DATABASE_URL: `postgres://test:local@localhost:5432/daisy_wt_${id}_test`,
        TEST_REDIS_URL: 'redis://localhost:6379/12',
        REDIS_URL: 'malformed-credential-sentinel',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    run.exited,
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);
  assert({
    given: 'an invalid lifecycle URL containing a credential sentinel',
    should: 'exit with only bounded sanitized refusal evidence',
    actual: { status, stdout, stderr },
    expected: {
      status: 1,
      stdout: '',
      stderr: '{"event":"room.launch.release","outcome":"refused"}\n',
    },
  });
});

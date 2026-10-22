import { roomCreateSchema } from '@daisy/protocol';
import { launchCustomSelection } from '../e2e/support/room-launch-custom';
import { decodeLaunchEvidence } from '../e2e/support/room-launch-evidence-decoder';
import { basename, resolve } from 'node:path';
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
      'run the owned web/realtime supervisor from its workspace and retain artifacts at the CI-registered paths',
    actual: { status, paths: JSON.parse(output) },
    expected: {
      status: 0,
      paths: {
        servers: [resolve(checkout, 'apps/web')],
        artifacts: resolve(checkout, 'apps/web/test-results'),
        report: resolve(
          checkout,
          'apps/web/test-results/room-launch-results.json',
        ),
      },
    },
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

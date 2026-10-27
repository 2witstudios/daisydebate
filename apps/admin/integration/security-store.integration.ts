import { randomBytes } from 'node:crypto';
import { createClient } from '@clickhouse/client-web';
import { requireTestClickHouse, requireTestServices } from '@daisy/config';
import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createSecurityStore } from '../src/features/security/store';
import { coverageBounds, windowBounds } from '../src/features/security/view';

setupRitewayBun();
requireTestServices(process.env);
const store = requireTestClickHouse(process.env);

const writer = createClient({
  url: store.url,
  username: 'daisy_shipper',
  password: store.shipperPassword,
});
afterAll(() => writer.close());
const security = createSecurityStore({
  url: store.url,
  password: store.readerPassword,
});

const now = new Date().toISOString();
const chNow = now.replace('T', ' ').replace('Z', '');
// The shared store serves every slot: this suite's rows carry a CSPRNG
// invariant id no other run can produce.
const invariantId = `test.${randomBytes(6).toString('hex')}`;
const violation = {
  received_at: chNow,
  ts: chNow,
  app: 'daisy-debate-staging',
  region: 'ord',
  instance: randomBytes(7).toString('hex'),
  service: 'web',
  app_version: '7d94b6b',
  git_commit: '7d94b6b153b556dabe0346bc2b727f989905e436',
  event: 'invariant.violated',
  severity: 'error',
  invariant_id: invariantId,
  operation: 'round.start',
};

describe('the security store', () => {
  test('reads a view through the reader role, bounded by the window', async () => {
    await writer.insert({
      table: 'daisy_logs.events',
      values: [violation, violation],
      format: 'JSONEachRow',
    });
    const read = await security.view(
      'invariants',
      windowBounds(new Date(Date.parse(now) + 1_000).toISOString(), '1h'),
    );
    const rows = read.kind === 'ok' ? (read.value[0] ?? []) : [];
    assert({
      given: 'two violations of one invariant inside the window',
      should: 'group them into one row with their count',
      actual: rows
        .filter((row) => row.invariant_id === invariantId)
        .map(({ invariant_id, operation, n }) => ({
          invariant_id,
          operation,
          n,
        })),
      expected: [{ invariant_id: invariantId, operation: 'round.start', n: 2 }],
    });
  });

  test('every view runs under the read-only profile', async () => {
    const bounds = windowBounds(now, '28d');
    // In turn, as the page reads: the reader role runs at most four queries
    // at once.
    const reads = [];
    for (const view of [
      'auth',
      'operator',
      'realtime',
      'invariants',
      'errors',
    ] as const)
      reads.push(await security.view(view, bounds));
    const coverage = await security.coverage(coverageBounds(now));
    assert({
      given: 'each view over the longest window, and the coverage reads',
      should: 'answer every one',
      actual: [...reads, coverage].map((read) => read.kind),
      expected: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
    });
  });

  test('an unreachable store is never an empty answer', async () => {
    const closed = createSecurityStore({
      url: 'http://127.0.0.1:9',
      password: store.readerPassword,
    });
    assert({
      given: 'a store nothing listens on',
      should: 'report unreachable rather than empty rows',
      actual: (await closed.view('auth', windowBounds(now, '1h'))).kind,
      expected: 'unreachable',
    });
  });
});

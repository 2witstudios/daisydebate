import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const sweepScript = new URL('../infra/clickhouse/sweep.sh', import.meta.url)
  .pathname;

/**
 * Runs the real sweep() against a stubbed `ch` that answers the partition
 * listing, each DROP and the record INSERT, failing where told. Returns
 * the calls the stub saw and sweep's exit status.
 */
const runSweep = ({
  listing,
  failListing = false,
  failDrop = false,
}: {
  readonly listing: string;
  readonly failListing?: boolean;
  readonly failDrop?: boolean;
}) => {
  const stub = `
    ch() {
      case "$*" in
        *INSERT*) echo "RECORD $*" >> "$LOG" ;;
        *DROP*) echo "DROP" >> "$LOG"; ${failDrop ? 'return 1' : 'return 0'} ;;
        *) cat > /dev/null; ${failListing ? 'return 1' : `printf '%b' "$LISTING"`} ;;
      esac
    }`;
  const log = `${process.env.TMPDIR ?? '/tmp'}/sweep-${crypto.randomUUID()}.log`;
  const result = Bun.spawnSync(
    [
      'bash',
      '-c',
      `${stub}; SWEEP_SQL=/dev/null; . "${sweepScript}"; touch "$LOG"; sweep`,
    ],
    { env: { ...process.env, LOG: log, LISTING: listing } },
  );
  const calls = Bun.spawnSync(['cat', log]).stdout.toString().trim();
  Bun.spawnSync(['rm', '-f', log]);
  return {
    status: result.exitCode,
    drops: calls.split('\n').filter((line) => line === 'DROP').length,
    recorded: calls.includes('RECORD'),
    recordedCount: /dropped=(\d+)/.exec(calls)?.[1] ?? null,
  };
};

describe('the retention sweep (ADR 0084 §5)', () => {
  test('records a sweep only when the listing and every drop succeeded', () => {
    assert({
      given: 'two expired partitions that drop, and nothing to drop',
      should: 'drop both and record two, then record zero',
      actual: [
        runSweep({
          listing: 'events\\t20260928\\nshipper_drops\\t20260928\\n',
        }),
        runSweep({ listing: '' }),
      ],
      expected: [
        { status: 0, drops: 2, recorded: true, recordedCount: '2' },
        { status: 0, drops: 0, recorded: true, recordedCount: '0' },
      ],
    });
  });

  test('a failed listing or drop is never recorded as a sweep', () => {
    assert({
      given: 'a listing that fails, and a drop that fails',
      should: 'return non-zero without recording, so the page reads unverified',
      actual: [
        runSweep({ listing: 'events\\t20260928\\n', failListing: true }),
        runSweep({ listing: 'events\\t20260928\\n', failDrop: true }),
      ],
      expected: [
        { status: 1, drops: 0, recorded: false, recordedCount: null },
        { status: 1, drops: 1, recorded: false, recordedCount: null },
      ],
    });
  });
});

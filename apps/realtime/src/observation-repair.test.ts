import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ObservationBase } from '@daisy/protocol';
import { createObservationRepair } from './observation-repair';
setupRitewayBun();
const view = (id: string): ObservationBase => ({
  schema: 1,
  resource: { kind: 'channel', id: id.repeat(24) },
  partition: { kind: 'shared', policyKey: 'channel-messages-v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
});
test('hinted repair reads one resource and mid-run requests rerun fully', async () => {
  const bases = [view('a'), view('b')];
  const reads: string[] = [];
  let release!: () => void;
  let paused = false;
  const repair = createObservationRepair({
    keys: () => bases.map((base) => [base.resource.id, base] as const),
    current: () => true,
    accept: () => {},
    touch: () => {},
    yieldWork: async () => {},
    closed: () => false,
    cache: {
      demand: async () => {},
      read: async (base) => {
        reads.push(base.resource.id[0]!);
        if (paused) {
          paused = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return null;
      },
    },
  });
  await repair(`channel-${'b'.repeat(24)}`);
  const hinted = [...reads];
  reads.length = 0;
  paused = true;
  const running = repair();
  await Promise.resolve();
  await repair(`channel-${'a'.repeat(24)}`);
  release();
  await running;
  assert({
    given: 'a hint for one resource, then a hint during a full pass',
    should: 'read only the hinted resource, then run one more complete pass',
    actual: { hinted, rerun: reads },
    expected: { hinted: ['b'], rerun: ['a', 'b', 'a', 'b'] },
  });
});

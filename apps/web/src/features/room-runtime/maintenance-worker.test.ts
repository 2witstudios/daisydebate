import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { manualWaits } from '../../lib/manual-waits.test-support';
import type { App } from '../../server/app';
import { startRoomLifecycleMaintenance } from './maintenance-worker';
setupRitewayBun();

test('the process starts Room maintenance with the Room policy and reports each Room as room.maintenance.failed (ISSUE-771)', async () => {
  const { tasks, waits } = manualWaits();
  const lines: unknown[][] = [];
  const candidateReads: unknown[] = [];
  const app = {
    database: {
      readMaintenanceCandidates: async (input: unknown) => {
        candidateReads.push(input);
        return ['broken', 'fine'];
      },
      maintainRoom: async (input: { roomId: string }) => {
        if (input.roomId === 'broken')
          throw createAppError('CONFLICT', 'room moved');
        return false;
      },
    },
    roomPolicy: { idleTimeoutMs: 600_000 },
    logger: { log: (...line: unknown[]) => lines.push(line) },
    ids: { next: () => 'r4n6p8r2t4v6x8z1k3b5c7d9' },
  } as unknown as App;
  const worker = startRoomLifecycleMaintenance({ app, waits });
  await worker.started;
  const pulsing = tasks.has(500);
  await worker.stop();
  assert({
    given:
      'a process Room policy of ten minutes and a page whose first Room refuses',
    should:
      'read candidates under that policy on a 500 ms pulse and log the refused Room with its own code',
    actual: { candidateReads, pulsing, lines },
    expected: {
      candidateReads: [{ idleTimeoutMs: 600_000, limit: 64 }],
      pulsing: true,
      lines: [
        [
          'room.maintenance.failed',
          { operation: 'room.maintenance.maintain', errorCode: 'CONFLICT' },
          'Room maintenance remains recoverable',
        ],
      ],
    },
  });
});

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runDeadManSwitch } from './dead-man-switch';

setupRitewayBun();

const LAPSED = { id: 'b1', egressId: 'EG_1' };

/** Each entry is one check's read: its rows, or 'down' for a failed read. */
const run = async (
  reads: readonly (readonly (typeof LAPSED)[] | 'down')[],
  over: { readonly stopFails?: boolean } = {},
) => {
  const log: string[] = [];
  let check = 0;
  await runDeadManSwitch({
    store: {
      listHeartbeatLapsed: async ({ staleMs }) => {
        const read = reads[check++];
        log.push(`read ${staleMs}`);
        if (read === 'down' || read === undefined) throw new Error('down');
        return read;
      },
      recordHeartbeatStop: async ({ id, egressId }) => {
        log.push(`recorded ${id} ${egressId}`);
      },
    },
    stopEgress: async (id) => {
      if (over.stopFails) throw new Error('livekit down');
      log.push(`stop ${id}`);
    },
    sleep: async () => {},
    stopped: () => check >= reads.length,
    report: (event) => log.push(event),
  });
  return log.filter((line) => !line.startsWith('read'));
};

describe('runDeadManSwitch', () => {
  test('stops a lapsed Egress on a read that follows a good read', async () => {
    assert({
      given: 'a good read, then a lapsed heartbeat',
      should: 'stop it, record that, and say so',
      actual: await run([[], [LAPSED]]),
      expected: ['stop EG_1', 'recorded b1 EG_1', 'broadcast.dead_man_stopped'],
    });
  });
  test('a failed read stops nothing, and neither does the read after it', async () => {
    assert({
      given:
        'the worker’s own read failing, then every heartbeat looking stale',
      should: 'report the failure and stop nothing yet',
      actual: await run(['down', [LAPSED]]),
      expected: ['broadcast.dead_man_failed'],
    });
  });
  test('a first read after starting stops nothing', async () => {
    assert({
      given: 'a stale heartbeat on the very first read',
      should: 'wait for a second look',
      actual: await run([[LAPSED]]),
      expected: [],
    });
  });
  test('a heartbeat back by the second look leaves the Egress running', async () => {
    assert({
      given: 'stale once after an outage, then fresh',
      should: 'stop nothing',
      actual: await run(['down', [LAPSED], []]),
      expected: ['broadcast.dead_man_failed'],
    });
  });
  test('a stop that fails records nothing, and the next check tries again', async () => {
    assert({
      given: 'LiveKit refusing the stop',
      should: 'report it and leave the row for the next check',
      actual: await run([[], [LAPSED]], { stopFails: true }),
      expected: ['broadcast.dead_man_failed'],
    });
  });
});

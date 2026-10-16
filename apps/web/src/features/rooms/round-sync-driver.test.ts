import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebateTopic,
  ENVELOPE_VERSION,
  type RoundView,
} from '@daisy/protocol';
import { driverEdges } from '../resource-sync/driver.test-support';
import { round } from '../room-runtime/operations.test-support';
import type { RoundRead } from './read-round';
import { createRoundSyncDriver, seedRoundSync } from './round-sync-driver';

setupRitewayBun();

const at = (version: number, patch: Partial<RoundView> = {}): RoundView => ({
  ...round,
  version,
  ...patch,
});

describe('round sync driver', () => {
  test('the round doorbell reads the round and adopts the newer revision', async () => {
    const edges = driverEdges<RoundRead>();
    const driver = createRoundSyncDriver({
      seed: seedRoundSync(at(2), edges.scheduler.now()),
      read: edges.read,
      scheduler: edges.scheduler,
      visibility: edges.visibility,
      connection: edges.connection,
    });
    edges.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: buildDebateTopic(round.id),
      position: '1:1',
      payload: {
        kind: 'debate.phase-changed',
        entityVersion: 3,
        ids: [round.id],
      },
    });
    edges.answer({ kind: 'found', round: at(3, { status: 'completed' }) });
    await edges.flush();
    edges.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: buildDebateTopic(round.id),
      position: '1:2',
      payload: {
        kind: 'debate.phase-changed',
        entityVersion: 3,
        ids: [round.id],
      },
    });
    assert({
      given:
        'the debate:<id> doorbell for revision 3, then the same doorbell again',
      should:
        'read once, adopt revision 3, and skip the doorbell it already covers',
      actual: {
        log: edges.log,
        held: [
          driver.readSnapshot().value.version,
          driver.readSnapshot().value.status,
        ],
      },
      expected: {
        log: [`subscribe ${buildDebateTopic(round.id)}`, 'connect', 'read'],
        held: [3, 'completed'],
      },
    });
  });
});

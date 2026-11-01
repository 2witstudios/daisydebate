import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildRoundTopic,
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
      topic: buildRoundTopic(round.id),
      position: '1:1',
      payload: {
        kind: 'round.phase-changed',
        entityVersion: 3,
        ids: [round.id],
      },
    });
    edges.answer({
      kind: 'found',
      round: at(3, { status: 'completed' }),
      serverNowMs: null,
      socketUrl: null,
    });
    await edges.flush();
    edges.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: buildRoundTopic(round.id),
      position: '1:2',
      payload: {
        kind: 'round.phase-changed',
        entityVersion: 3,
        ids: [round.id],
      },
    });
    assert({
      given:
        'the round:<id> doorbell for revision 3, then the same doorbell again',
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
        log: [`subscribe ${buildRoundTopic(round.id)}`, 'connect', 'read'],
        held: [3, 'completed'],
      },
    });
  });
});

test('same-version visibility and reconnect reads calibrate the shared clock through the production driver', async () => {
  const { createMeasuredRead, createRoundTime } = await import('./round-time');
  const edges = driverEdges<RoundRead>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs: 1,
  });
  let generation = 0;
  const read = createMeasuredRead({
    read: edges.read,
    roundTime,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => ++generation,
  });
  const driver = createRoundSyncDriver({
    seed: seedRoundSync(at(2), edges.scheduler.now()),
    read,
    scheduler: edges.scheduler,
    visibility: edges.visibility,
    connection: edges.connection,
  });
  edges.hide();
  edges.advance(6000);
  edges.show();
  edges.answer({
    kind: 'found',
    round: at(2),
    serverNowMs: 50000,
    socketUrl: null,
  });
  await edges.flush();
  assert({
    given:
      'delayed hydration followed by an authorized same-version visibility read',
    should: 'replace the seed without a Round mutation',
    actual: [
      driver.readSnapshot().value.version,
      roundTime.nowMs(),
      roundTime.status().kind,
    ],
    expected: [2, 50000, 'current'],
  });
  edges.connectionState({ status: 'open', generation: 1, terminal: null });
  edges.connectionState({ status: 'closed', generation: 1, terminal: null });
  edges.advance(500);
  edges.connectionState({ status: 'open', generation: 2, terminal: null });
  edges.answer({
    kind: 'found',
    round: at(2),
    serverNowMs: 50500,
    socketUrl: null,
  });
  await edges.flush();
  assert({
    given: 'a reconnect with the same held Round revision',
    should: 'make fresh timing evidence reach the same owner',
    actual: [
      roundTime.calibration()?.generation,
      roundTime.nowMs(),
      driver.readSnapshot().value.version,
    ],
    expected: [2, 50500, 2],
  });
  driver.dispose();
});

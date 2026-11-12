import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildRoundTopic,
  ENVELOPE_VERSION,
  type RoundView,
} from '@daisy/protocol';
import { driverEdges } from '../resource-sync/driver.test-support';
import { inLifecycle, round } from './round.test-support';
import type { RoundRead } from './read-round';
import {
  createRoundSyncDriver,
  openingDeadline,
  seedRoundSync,
} from './round-sync-driver';

setupRitewayBun();

const at = (
  version: number,
  patch: Partial<Pick<RoundView, 'opening'>> = {},
  from: RoundView = round,
): RoundView => ({ ...from, version, ...patch });

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
      round: at(
        3,
        {},
        inLifecycle(round, {
          status: 'completed',
          startedAt: '2026-10-12T18:00:00.000Z',
          completedAt: '2026-10-12T18:30:00.000Z',
          outcome: null,
        }),
      ),
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

describe('openingDeadline', () => {
  const turn = {
    ordinal: 0,
    side: 'negative',
    dueAt: '2026-10-12T00:01:00.000Z',
    remainingMs: 15_000,
  } as const;
  const draw = {
    visibility: 'progress',
    drawSize: 3,
    strikes: [],
    turn,
    revealedAt: null,
  } as const;
  const deadline = (opening: RoundView['opening']) =>
    openingDeadline(seedRoundSync(at(2, { opening }), 1000));

  test('a strike and prep are read again when their time runs out', () => {
    assert({
      given: 'a strike with 15 s left and prep with 60 s left, read at 1000',
      should: 'read exactly when each runs out',
      actual: [
        deadline({ step: { step: 'strike' }, draw, canStrike: false }),
        deadline({
          step: {
            step: 'prep',
            startedAt: '2026-10-12T00:00:00.000Z',
            endsAt: '2026-10-12T00:01:00.000Z',
            remainingMs: 60_000,
          },
          draw: null,
          canStrike: false,
        }),
      ],
      expected: [16_000, 61_000],
    });
  });

  test('anything else has no deadline, and a read at zero schedules none', () => {
    assert({
      given: 'no opening, a completed opening and a turn with no time left',
      should: 'schedule no read',
      actual: [
        deadline(null),
        deadline({
          step: { step: 'complete', at: '2026-10-12T00:00:00.000Z' },
          draw: null,
          canStrike: false,
        }),
        deadline({
          step: { step: 'strike' },
          draw: { ...draw, turn: { ...turn, remainingMs: 0 } },
          canStrike: false,
        }),
      ],
      expected: [null, null, null],
    });
  });
});

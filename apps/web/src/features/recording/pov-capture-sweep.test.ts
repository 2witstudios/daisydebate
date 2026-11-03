import type { PovEgress } from '@daisy/media/pov';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createPovCaptureSweep } from './pov-capture-sweep';

setupRitewayBun();

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
const capturing = {
  status: 'capturing',
  capture: { source: { kind: 'own_capture' }, startedAt: '', attempts: [] },
};
const open = (over: Record<string, unknown> = {}) => ({
  id: 'rec',
  roundId: 'round',
  lifecycle: capturing,
  roundStatus: 'active',
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  recordingId: 'rec',
  roundId: 'round',
  roundParticipantId: 'aff',
  camera: true,
  egressRoom: null,
  egressId: null,
  egressStartedAt: null,
  egressGeneration: 0,
  observerRevokedAt: null,
  revocationFailures: 0,
  cameraHeight: 540,
  reconcileLeaseUntil: null,
  endedAt: null,
  createdAt: new Date(NOW),
  ...over,
});
const SEATS = [
  {
    roundParticipantId: 'aff',
    role: 'affirmative',
    kind: 'human',
    identity: 'id-aff',
  },
  {
    roundParticipantId: 'neg',
    role: 'negative',
    kind: 'bot',
    identity: 'id-neg',
  },
  {
    roundParticipantId: 'jud',
    role: 'judge',
    kind: 'human',
    identity: 'id-jud',
  },
];

const setup = (
  over: {
    readonly open?: unknown;
    readonly rows?: readonly unknown[];
    readonly phase?: { readonly kind: 'public' | 'private' };
    readonly egressFact?: unknown;
    readonly present?: readonly unknown[];
    readonly claim?: boolean;
    readonly startWon?: boolean;
    readonly failing?: string;
    readonly enabled?: boolean;
  } = {},
) => {
  const calls: unknown[][] = [];
  const events: string[] = [];
  const log =
    (name: string, answer?: unknown) =>
    async (...args: unknown[]) => {
      if (over.failing === name) throw new Error('down');
      calls.push([name, ...args]);
      return answer;
    };
  const egress = {
    start: log('start', 'EG_NEW'),
    stop: log('stop'),
    read: async () => over.egressFact ?? { kind: 'none' },
    revoke: log('revoke'),
    restore: log('restore'),
    participants: async () =>
      over.present ??
      SEATS.map(({ identity }) => ({ identity, cameraHeight: 540 })),
  } as unknown as PovEgress;
  const sweep = createPovCaptureSweep({
    store: {
      listOpen: async (_limit: number, after: string | null) =>
        after === null ? [over.open ?? open()] : [],
      readRound: async () => ({ roomName: 'room-1', round: {} }),
      readSeats: async () => SEATS,
      listPovs: async () => over.rows ?? [row()],
      open: log('open'),
      claim: async () => over.claim ?? true,
      hold: log('hold'),
      recordStarted: log('recordStarted', over.startWon ?? true),
      recordRevoked: log('recordRevoked'),
      recordRevocationFailed: log('recordRevocationFailed'),
      recordRestored: log('recordRestored'),
      recordCameraHeight: log('recordCameraHeight'),
      close: log('close'),
    } as never,
    enabled: over.enabled ?? true,
    egressFor: () => egress,
    phaseAt: () => over.phase ?? { kind: 'public' },
    now: () => NOW,
    report: (event) => events.push(event),
  });
  const named = (name: string) => calls.filter(([call]) => call === name);
  return { sweep, calls, events, named };
};

describe('createPovCaptureSweep', () => {
  test('opens a capture for each debater and none for a judge', async () => {
    const { sweep, named } = setup();
    await sweep();
    assert({
      given: 'two debaters and a human judge, all in the room',
      should: 'open the debaters, the bot with no camera',
      actual: named('open').map(([, input]) => {
        const { roundParticipantId, camera } = input as {
          roundParticipantId: string;
          camera: boolean;
        };
        return [roundParticipantId, camera];
      }),
      expected: [
        ['aff', true],
        ['neg', false],
      ],
    });
  });
  test('starts under its own attempt, in the room, by identity', async () => {
    const { sweep, named } = setup({
      rows: [
        row({ egressGeneration: 2, egressStartedAt: new Date(NOW - 60_000) }),
      ],
    });
    await sweep();
    assert({
      given: 'a debater with two attempts behind them',
      should: 'hold the third apart and record it',
      actual: [
        named('start')[0]?.[1],
        (named('recordStarted')[0]?.[1] as { generation: number }).generation,
      ],
      expected: [
        {
          room: 'room-1',
          identity: 'id-aff',
          holdPrefix: 'recording-hold/rec/pov/aff/3/',
          segmentSeconds: 4,
        },
        3,
      ],
    });
  });
  test('a judge is never started, even with a row and a place in the room', async () => {
    const { sweep, named } = setup({
      rows: [row({ roundParticipantId: 'jud' })],
    });
    await sweep();
    assert({
      given: 'a stray row for the judge seat',
      should: 'still open only debaters; the row is reconciled by its own seat',
      actual: named('open').some(
        ([, input]) =>
          (input as { roundParticipantId: string }).roundParticipantId ===
          'jud',
      ),
      expected: false,
    });
  });
  test('a lost race stops what it started', async () => {
    const { sweep, named, events } = setup({ startWon: false });
    await sweep();
    assert({
      given: 'another instance recorded this attempt first',
      should: 'stop this Egress and say so',
      actual: [named('stop')[0]?.[1], events],
      expected: ['EG_NEW', ['recording.pov.start_lost']],
    });
  });
  test('a refused start asks again later, and touches nothing else', async () => {
    const { sweep, named, events } = setup({ failing: 'start' });
    await sweep();
    const released = named('hold').at(-1)?.[1] as { until: Date | null };
    assert({
      given: 'a pool with no capacity',
      should: 'report it and keep the claim for the retry delay',
      actual: [events, released.until?.getTime()],
      expected: [['recording.pov.start_failed'], NOW + 10_000],
    });
  });
  test('a private phase revokes in the room the Egress joined', async () => {
    const { sweep, named } = setup({
      phase: { kind: 'private' },
      egressFact: { kind: 'active', id: 'EG' },
      rows: [
        row({
          egressId: 'EG',
          egressRoom: 'old-room',
          egressStartedAt: new Date(NOW),
        }),
      ],
    });
    await sweep();
    assert({
      given: 'a running POV when prep begins',
      should: 'revoke it, then record that',
      actual: [named('revoke')[0]?.slice(1), named('recordRevoked').length],
      expected: [['old-room', 'EG'], 1],
    });
  });
  test('a failed revocation counts toward stopping the Egress', async () => {
    const { sweep, named } = setup({
      phase: { kind: 'private' },
      egressFact: { kind: 'active', id: 'EG' },
      failing: 'revoke',
      rows: [row({ egressId: 'EG', egressRoom: 'room-1' })],
    });
    await sweep();
    assert({
      given: 'a revocation the room refuses',
      should: 'count it',
      actual: named('recordRevocationFailed').length,
      expected: 1,
    });
  });
  test('an unreadable Egress is not started over', async () => {
    const { sweep, named } = setup({
      rows: [
        row({
          egressId: 'EG',
          egressRoom: 'room-1',
          egressStartedAt: new Date(NOW - 60_000),
        }),
      ],
      egressFact: { kind: 'starting', id: 'EG' },
    });
    await sweep();
    assert({
      given: 'an Egress still starting',
      should: 'start nothing',
      actual: named('start').length,
      expected: 0,
    });
  });
  test('a camera the room reports sets the label, once tall enough to stop asking', async () => {
    const low = setup({ rows: [row({ cameraHeight: null })] });
    await low.sweep();
    const done = setup({
      rows: [row({ cameraHeight: 540 })],
      egressFact: { kind: 'active', id: 'EG' },
    });
    await done.sweep();
    assert({
      given: 'no height yet; a height already at full quality on a running POV',
      should: 'record the first and not ask for the second',
      actual: [
        (low.named('recordCameraHeight')[0]?.[1] as { height: number }).height,
        done.named('recordCameraHeight').length,
      ],
      expected: [540, 0],
    });
  });
  test('the Round over closes each POV once nothing runs', async () => {
    const { sweep, named } = setup({
      open: open({ roundStatus: 'completed' }),
      rows: [row({ egressId: 'EG', egressRoom: 'room-1' })],
      egressFact: { kind: 'complete' },
    });
    await sweep();
    assert({
      given: 'a finished Round and a finished Egress',
      should: 'close it, and open nothing new',
      actual: [named('close').length, named('open').length],
      expected: [1, 0],
    });
  });
  test('switched off, what runs is stopped and closed, so nothing waits on it', async () => {
    const running = setup({
      enabled: false,
      rows: [row({ egressId: 'EG', egressRoom: 'room-1' })],
      egressFact: { kind: 'active', id: 'EG' },
    });
    await running.sweep();
    const done = setup({ enabled: false });
    await done.sweep();
    assert({
      given: 'POV capture off with one running, then with none',
      should: 'stop the first, close the second, and start or open nothing',
      actual: [
        running.named('stop').length,
        done.named('close').length,
        done.named('start').length,
        done.named('open').length,
      ],
      expected: [1, 1, 0, 0],
    });
  });
  test('a claim held elsewhere is left alone', async () => {
    const { sweep, named } = setup({ claim: false });
    await sweep();
    assert({
      given: 'another instance holding this POV',
      should: 'start nothing',
      actual: named('start').length,
      expected: 0,
    });
  });
  test('a failure on one POV reaches nothing else', async () => {
    const { sweep, named, events } = setup({
      failing: 'recordCameraHeight',
      rows: [
        row({ cameraHeight: null }),
        row({ roundParticipantId: 'neg', camera: false, cameraHeight: null }),
      ],
    });
    await sweep();
    assert({
      given: 'a store failure on the first of two',
      should: 'report it and start the other',
      actual: [
        events,
        (named('start')[0]?.[1] as { identity: string }).identity,
      ],
      expected: [['recording.pov_capture_failed'], 'id-neg'],
    });
  });
});

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundCompetitiveMaintenance } from './round-maintenance';
setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const [first, second, probeRound] = [id('a'), id('b'), id('p')];

async function maintained(probe: string | undefined) {
  const seen: string[] = [];
  const service = startRoundCompetitiveMaintenance({
    app: {
      config: { ATTENDANCE_PUBLIC_PROBE: probe },
      ids: { next: () => id('g') },
      logger: { log: () => {} },
      database: {
        readRoundMaintenanceCandidates: async () => ({
          roundIds: [first, probeRound, second],
          afterId: null,
          exhausted: true,
        }),
        tickDueRound: async ({ roundId }: { roundId: string }) => {
          seen.push(roundId);
        },
        evaluateRoundAttendance: async () => ({ kind: 'undecided' as const }),
        finalizeDueRoundTranscript: async () => ({ status: 'pending' }),
        readRatingCandidates: async () => [],
      },
    } as never,
    instanceId: id('i'),
    timers: { setInterval: () => 1, clearInterval: () => {} },
  });
  await service.ready;
  // The fleet holds two at a time: let the queue drain before stopping.
  for (let turn = 0; turn < 4; turn++) await new Promise(setImmediate);
  await service.stop();
  return seen.sort();
}

test('ISSUE-532: the real wiring passes the configured probe Round to maintenance', async () => {
  assert({
    given: 'ATTENDANCE_PUBLIC_PROBE naming a Round',
    should: 'leave exactly that Round out of maintenance',
    actual: await maintained(
      JSON.stringify({
        origin: 'https://daisy.test/',
        roundId: probeRound,
        segmentId: id('s'),
        participantId: id('m'),
        cookie: 'c',
      }),
    ),
    expected: [first, second].sort(),
  });
  assert({
    given: 'no ATTENDANCE_PUBLIC_PROBE',
    should: 'maintain every candidate',
    actual: await maintained(undefined),
    expected: [first, second, probeRound].sort(),
  });
});

async function reportedBy(database: Record<string, unknown>) {
  const logged: unknown[] = [];
  const service = startRoundCompetitiveMaintenance({
    app: {
      config: {},
      ids: { next: () => id('g') },
      logger: { log: (entry: unknown) => logged.push(entry) },
      database: {
        readRoundMaintenanceCandidates: async () => ({
          roundIds: [first],
          afterId: null,
          exhausted: true,
        }),
        tickDueRound: async () => {},
        evaluateRoundAttendance: async () => ({ kind: 'undecided' as const }),
        finalizeDueRoundTranscript: async () => ({ status: 'pending' }),
        readRatingCandidates: async () => [],
        ...database,
      },
    } as never,
    instanceId: id('i'),
    timers: { setInterval: () => 1, clearInterval: () => {} },
  });
  await service.ready;
  for (let turn = 0; turn < 4; turn++) await new Promise(setImmediate);
  await service.stop();
  return JSON.stringify(logged).includes('round.judging.failed');
}
type Reports = { readonly judgingEnded?: (reason: string) => void };

test('a judging job maintenance ended reaches the failure report, by either path', async () => {
  assert({
    given: 'the evaluator reporting a job it ended',
    should: 'log the judging failure event',
    actual: await reportedBy({
      evaluateRoundAttendance: async (input: Reports) => {
        input.judgingEnded?.('ballot_hold_ended');
        return { kind: 'undecided' as const };
      },
    }),
    expected: true,
  });
  assert({
    given: 'completion reporting a job it ended',
    should: 'log the judging failure event',
    actual: await reportedBy({
      finalizeDueRoundTranscript: async () => ({
        status: 'frozen',
        freeze: { revision: 1 },
      }),
      completePanelRound: async (input: Reports) => {
        input.judgingEnded?.('ballot_hold_ended');
      },
    }),
    expected: true,
  });
});

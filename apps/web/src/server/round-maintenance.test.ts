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
        evaluateRoundAttendance: async () => null,
        finalizeDueRoundTranscript: async () => ({ status: 'pending' }),
        readUnratedRatingRounds: async () => [],
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

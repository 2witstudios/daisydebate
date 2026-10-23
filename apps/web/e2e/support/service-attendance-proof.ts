import type { Browser } from '@playwright/test';
import { expect } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { createHumanBallotRound } from './human-ballot-round';
import {
  actualSpeech,
  enterSpeech,
  healthyAttendance,
  pastOriginalAttendanceGrace,
  attendedResolution,
  closeAttendedFixture,
  nextReceipt,
} from './attendance-browser';
import { attendanceEvidence } from './attendance-evidence';
import { elapsedAttendanceObservationUs } from './attendance-evidence-decoder';
import { authenticatedAttendanceSocket } from './attendance-socket';
import {
  controlLaunch,
  closeSettledLaunchContexts,
} from './room-launch-settled';

export async function serviceAttendanceOutage(
  browser: Browser,
  service: 'web' | 'realtime',
) {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  const host = accounts.members[0]!.context;
  const stop = service === 'web' ? 'stop-web' : 'stop-realtime';
  const start = service === 'web' ? 'start-web' : 'start-realtime';
  let stopped = false;
  try {
    const round = await createHumanBallotRound(accounts.members);
    const speech = await actualSpeech(host.request, round.id);
    const opponent = await enterSpeech(
      accounts.members[1]!.context,
      round.id,
      `opponent present before ${service} outage`,
    );
    await authenticatedAttendanceSocket(opponent.connections, round.id);
    await healthyAttendance(round.id);
    await controlLaunch(stop);
    stopped = true;
    if (service === 'realtime')
      await expect
        .poll(() =>
          opponent.connections
            .filter((row) => row.ready)
            .every((row) => row.closed),
        )
        .toBe(true);
    const lastSample = (await attendanceEvidence(round.id)).samples.at(-1)!;
    await expect
      .poll(
        async () => {
          const facts = await attendanceEvidence(round.id);
          const leases = facts.instances.filter((row) => row.role === service);
          return (
            leases.length > 0 &&
            leases.every(
              (row) =>
                Date.parse(facts.observedAt) - Date.parse(row.renewedAt) >
                3_000,
            )
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await pastOriginalAttendanceGrace(round.id, speech.startedAt);
    const during = await attendanceEvidence(round.id);
    expect(during.status).toBe('active');
    expect(during.adjudications).toEqual([]);
    if (service === 'realtime')
      expect(during.samples.at(-1)?.cause).toBe('realtime_stale');
    else expect(during.samples.at(-1)?.at).toBe(lastSample.at);
    await restartService(service, start, opponent, round.id);
    stopped = false;
    await authenticatedAttendanceSocket(
      opponent.connections,
      round.id,
      service === 'realtime' ? 2 : 1,
    );
    const joined = await enterSpeech(
      host,
      round.id,
      `speaker returns after ${service} outage`,
    );
    expect(joined.receipt.segmentId).toBe(speech.id);
    expect(
      elapsedAttendanceObservationUs(
        joined.receipt.receivedAt,
        speech.startedAt,
      ),
    ).toBeGreaterThan(40_000_000n);
    await healthyAttendance(round.id);
    await attendedResolution(round.id, speech.id);
    // The per-second public probe may hold a transient attempt; a stuck marker never clears.
    await expect
      .poll(async () => (await attendanceEvidence(round.id)).pendingAttempts)
      .toBe(0);
    const recovered = await attendanceEvidence(round.id);
    expect(recovered.status).toBe('active');
    expect(
      recovered.receipts.some(
        (row) =>
          row.commandId === joined.receipt.commandId &&
          row.receivedAt === joined.receipt.receivedAt,
      ),
    ).toBe(true);
    if (service === 'web') {
      const next = recovered.samples.find((row) => row.at > lastSample.at);
      expect(next).toBeDefined();
      expect(
        elapsedAttendanceObservationUs(next!.at, lastSample.at),
      ).toBeGreaterThan(2_000_000n);
    }
    await closeAttendedFixture(
      host.request,
      round.id,
      joined.receipt.participantId,
    );
  } finally {
    try {
      if (stopped) await controlLaunch(start);
    } finally {
      await closeSettledLaunchContexts(accounts);
    }
  }
}

/** Only a socket reconnect replays the recorded receipt; a web-only outage leaves the realtime socket up. */
async function restartService(
  service: 'web' | 'realtime',
  start: 'start-web' | 'start-realtime',
  opponent: Awaited<ReturnType<typeof enterSpeech>>,
  roundId: string,
) {
  if (service === 'web') return controlLaunch(start);
  const replay = await nextReceipt(opponent.page, roundId, () =>
    controlLaunch(start),
  );
  expect(replay.receivedAt).toBe(opponent.receipt.receivedAt);
}

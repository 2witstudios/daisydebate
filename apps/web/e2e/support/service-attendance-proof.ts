import type { Browser } from '@playwright/test';
import { expect } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './human-ballot-round';
import {
  actualSpeech,
  enterSpeech,
  healthyAttendance,
  pastOriginalAttendanceGrace,
  attendedResolution,
} from './attendance-browser';
import { attendanceEvidence } from './attendance-evidence';
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
    await enterSpeech(
      accounts.members[1]!.context,
      round.id,
      `opponent present before ${service} outage`,
    );
    await healthyAttendance(round.id);
    await controlLaunch(stop);
    stopped = true;
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
    await controlLaunch(start);
    stopped = false;
    const joined = await enterSpeech(
      host,
      round.id,
      `speaker returns after ${service} outage`,
    );
    expect(joined.receipt.segmentId).toBe(speech.id);
    expect(
      Date.parse(joined.receipt.receivedAt) - Date.parse(speech.startedAt),
    ).toBeGreaterThan(40_000);
    await healthyAttendance(round.id);
    await attendedResolution(round.id, speech.id);
    const recovered = await attendanceEvidence(round.id);
    expect(recovered.status).toBe('active');
    expect(recovered.pendingAttempts).toBe(0);
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
      expect(Date.parse(next!.at) - Date.parse(lastSample.at)).toBeGreaterThan(
        2_000,
      );
    }
    const current = await readBallotRound(host.request, round.id);
    await ballotRoundCommand(host.request, current, {
      type: 'forfeit',
      participantId: joined.receipt.participantId,
    });
  } finally {
    try {
      if (stopped) await controlLaunch(start);
    } finally {
      await closeSettledLaunchContexts(accounts);
    }
  }
}
